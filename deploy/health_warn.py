#!/usr/bin/env python3
"""Vessel 的 worker 停擺提醒。

2026-10-27 worker 跟資料庫的連線斷了，一直拿斷掉的連線重試，一個多小時沒有讀到任何用量，
容器與 API 都是健康的，直到使用者發現用量一直是 0。這支腳本從 cron 定時讀後端的
/internal/health，worker 太久沒有完成一輪、某個節點的用量太久沒有讀到、某個節點的網站自測
太久沒有更新、有工作卡住，或後端沒有回應時，推播到 ntfy。

只在狀態改變時推播：開始出問題推一次、問題的組合有變化推一次、恢復再推一次。
上一次的狀態記在 VESSEL_HEALTH_STATE。做法跟 Pulse 的 tools/freshness_warn.py 相同。

節點打不開的網站（某個節點打不開、其他節點打得開，跟服務狀態頁相同）另外比對：有網站新打不開
或恢復時推一則一般優先的通知，上一次的清單記在 VESSEL_REACH_STATE。第一次執行只記下清單，不推播。

各城市的出口 IP 也逐一到 DNS 黑名單（VESSEL_DNSBL）查詢，被列入或移出時推播，上一次的結果記在
VESSEL_DNSBL_STATE。節點不記錄連線的目的地，有裝置寄垃圾信、掃描或攻擊其他主機時，出口 IP 被列入
黑名單是我們看得到的少數訊號之一。

只用標準函式庫，在部署主機上用系統的 python3 執行。

    VESSEL_NTFY=http://<ntfy 主機>/<topic> python3 deploy/health_warn.py

環境變數：
    VESSEL_NTFY            ntfy 的 topic 網址，必填
    VESSEL_HEALTH_URL      預設 http://127.0.0.1:8090/internal/health，埠要跟 deploy/.env 的 VESSEL_API_PORT 一致
    VESSEL_HEALTH_STATE    預設 ~/.cache/vessel-health.state
    VESSEL_REACH_STATE     預設 ~/.cache/vessel-reach.state
    VESSEL_DNSBL           查詢的黑名單，空白分隔，預設見下方的 DNSBL，設成空值就不查
    VESSEL_DNSBL_STATE     預設 ~/.cache/vessel-dnsbl.state
    --force                不管狀態有沒有變都推播一次，用來測試通知
    --dnsbl                只查一次黑名單並印出每一筆的結果，不推播也不更新狀態，用來確認名單可以查詢
"""

import json
import os
import socket
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path

URL = os.environ.get("VESSEL_HEALTH_URL", "http://127.0.0.1:8090/internal/health")
NTFY = os.environ.get("VESSEL_NTFY", "")
STATE = Path(os.environ.get("VESSEL_HEALTH_STATE", Path.home() / ".cache" / "vessel-health.state"))
REACH_STATE = Path(os.environ.get("VESSEL_REACH_STATE", Path.home() / ".cache" / "vessel-reach.state"))
DNSBL_STATE = Path(os.environ.get("VESSEL_DNSBL_STATE", Path.home() / ".cache" / "vessel-dnsbl.state"))
# Lists that answer through the host's resolver (checked on m6, 2026-11). Spamhaus refuses queries that come through
# public resolvers (it answers 127.255.255.254, read here as unknown); with its free DQS key, add
# <key>.zen.dq.spamhaus.net to VESSEL_DNSBL.
DNSBL = os.environ.get("VESSEL_DNSBL", "bl.spamcop.net b.barracudacentral.org dnsbl.dronebl.org psbl.surriel.com").split()
DNSBL_TIMEOUT = 20  # seconds for all the lookups together
# getaddrinfo's codes for a name that does not exist: the address is not on the list
NOT_FOUND = {socket.EAI_NONAME, getattr(socket, "EAI_NODATA", socket.EAI_NONAME)}

# the worker finishes a round every 10 seconds and reads the nodes every 5 minutes
WORKER_STALE = 5 * 60
USAGE_STALE = 20 * 60
# the nodes check common sites every hour (node/host/vessel-reach.py); three hours without a check means the timer stopped
REACH_STALE = 3 * 3600
STREAM_STALE = 900  # 秒，worker 每 5 分鐘確認一次，節點斷線後 15 秒內會重連


def evaluate(data: dict) -> tuple[str, list[str]]:
    """（狀態，說明的每一行）。狀態是 ok，或出問題的項目用逗號接起來。"""
    problems, lines = [], []
    age = data.get("worker_age")
    if age is None or age > WORKER_STALE:
        problems.append("worker")
        lines.append("- worker：" + ("沒有紀錄" if age is None else f"{age // 60} 分鐘沒有完成一輪"))
    for region, age in sorted(data.get("usage_age", {}).items()):
        if age is None or age > USAGE_STALE:
            problems.append(f"usage:{region}")
            lines.append(f"- {region} 節點：" + ("還沒讀過用量" if age is None else f"{age // 60} 分鐘沒有讀到用量"))
    for region, age in sorted(data.get("reach_age", {}).items()):
        if age > REACH_STALE:
            problems.append(f"reach:{region}")
            lines.append(f"- {region} 節點：網站自測 {age // 3600} 小時沒有更新")
    analysis = data.get("analysis_age")
    if analysis is not None and analysis > 1800:
        problems.append("analysis")
        lines.append(f"- 分析主機超過 {analysis // 60} 分鐘沒有回應，檢測中的裝置這段時間沒有資料")
    for region, age in sorted(data.get("stream_age", {}).items()):
        if age is None or age > STREAM_STALE:
            problems.append(f"stream:{region}")
            lines.append(f"- {region} 節點的檢測串流沒有連上分析主機" + ("" if age is None else f"，已經 {age // 60} 分鐘") + "，檢測中的裝置這段時間沒有資料")
    if data.get("stuck_jobs"):
        problems.append("jobs")
        lines.append(f"- 有 {data['stuck_jobs']} 個節點工作排隊超過 15 分鐘")
    return (",".join(problems) or "ok"), lines


def fetch() -> dict | str:
    """The health data, or why there is none."""
    try:
        with urllib.request.urlopen(URL, timeout=30) as resp:
            return json.load(resp)
    except Exception as err:  # 連不上、5xx、逾時都算後端沒有回應
        return f"{URL} 沒有回應：{err}\n\n先看 sudo docker compose ps 與 api 的 log。"


def check(data: dict | str) -> tuple[str, str]:
    if isinstance(data, str):
        return "api-down", data
    state, lines = evaluate(data)
    if state == "ok":
        return state, "worker、各節點的用量讀取與網站自測都正常。"
    if "worker" in state:
        hint = "worker 停了或連不上資料庫：sudo docker compose logs --tail 50 worker，必要時 restart worker。"
    elif "usage:" in state or "jobs" in state:
        hint = "worker 正常但連不上節點：從 m6 經 tailnet 連節點，看 awgctl list 與 worker 的 log。"
    else:
        hint = "節點的網站自測停了：在節點上看 systemctl status vessel-reach.timer vessel-reach.service 與 /opt/vessel-node/reach.json。"
    return state, "\n".join(lines) + "\n\n" + hint


def blocked(data: dict) -> set[str]:
    """`region:site` for each site a node cannot open while another node can."""
    return {f"{region}:{site}" for region, sites in data.get("reach_blocked", {}).items() for site in sites}


def reach_change(now: set[str], before: set[str]) -> str:
    """The body of the notice when the blocked sites change: what newly fails, then what recovered."""
    lines = [f"- {item.replace(':', ' 節點打不開 ', 1)}" for item in sorted(now - before)]
    lines += [f"- {item.replace(':', ' 節點恢復 ', 1)}" for item in sorted(before - now)]
    return "\n".join(lines) + "\n\n各節點打不開的網站：https://vessel.anoni.net/status/#reach"


def notify(title: str, body: str, priority: str, tags: str) -> None:
    # 標題有中文，HTTP 標頭只能放 latin-1，改用 ntfy 的查詢參數
    query = urllib.parse.urlencode({"title": title, "priority": priority, "tags": tags})
    req = urllib.request.Request(f"{NTFY}?{query}", data=body.encode(), method="POST")
    urllib.request.urlopen(req, timeout=15).read()


def main() -> int:
    if "--dnsbl" in sys.argv[1:]:
        data = fetch()
        if isinstance(data, str):
            print(data, file=sys.stderr)
            return 1
        for key, answer in sorted(dnsbl_results(data).items()):
            print(f"{key}\t{answer}")
        return 0
    if not NTFY:
        print("VESSEL_NTFY 沒有設定", file=sys.stderr)
        return 2
    force = "--force" in sys.argv[1:]
    data = fetch()
    if isinstance(data, dict):
        watch_reach(data)
        watch_dnsbl(data)
    state, body = check(data)
    previous = STATE.read_text().strip() if STATE.exists() else "ok"
    if state == previous and not force:
        print(f"vessel health: {state}（沒有變化，不推播）")
        return 0
    if state == "ok":
        title, priority, tags = "Vessel 已恢復", "default", "white_check_mark"
    elif state == "api-down":
        title, priority, tags = "Vessel 後端沒有回應", "high", "warning"
    else:
        title, priority, tags = f"Vessel 異常：{state}", "high", "warning"
    try:
        notify(title, body, priority, tags)
    except Exception as err:
        # 推播失敗就不更新狀態，下一次再試
        print(f"vessel health: {state}，推播失敗：{err}", file=sys.stderr)
        return 1
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(state + "\n")
    print(f"vessel health: {previous} → {state}，已推播")
    return 0


def watch_reach(data: dict) -> None:
    """Notify when the sites a node cannot open change. A failed notice leaves the state as it was, to try again."""
    now = blocked(data)
    if not REACH_STATE.exists():
        REACH_STATE.parent.mkdir(parents=True, exist_ok=True)
        REACH_STATE.write_text("\n".join(sorted(now)) + "\n")
        print(f"vessel reach: {len(now)} 個網站打不開，第一次執行，只記下來")
        return
    before = {line for line in REACH_STATE.read_text().splitlines() if line}
    if now == before:
        return
    try:
        notify("Vessel 節點打不開的網站有變化", reach_change(now, before), "default", "globe_with_meridians")
    except Exception as err:
        print(f"vessel reach: 推播失敗：{err}", file=sys.stderr)
        return
    REACH_STATE.write_text("\n".join(sorted(now)) + "\n")
    print(f"vessel reach: {len(before)} → {len(now)} 個，已推播")


def dnsbl_answer(ip: str, zone: str) -> str:
    """listed, clear, or unknown: the list refused the query (an answer in 127.255.255.0/24, as Spamhaus gives
    through public resolvers), the resolver failed, or the answer is not a list's (outside 127.0.0.0/8, a resolver
    that rewrites missing names)."""
    try:
        addr = socket.gethostbyname(".".join(reversed(ip.split("."))) + "." + zone)
    except socket.gaierror as err:
        return "clear" if err.errno in NOT_FOUND else "unknown"
    except OSError:
        return "unknown"
    if addr.startswith("127.255.255.") or not addr.startswith("127."):
        return "unknown"
    return "listed"


def dnsbl_results(data: dict) -> dict[str, str]:
    """`region:zone` (`region(舊):zone` for an old host still in use) to each lookup's answer. IPv6 addresses are
    left out; the lists here cover IPv4. Lookups that do not finish in DNSBL_TIMEOUT count as unknown."""
    keys = {}
    for exit_ in data.get("exits", []):
        if ":" in exit_["ip"]:
            continue
        label = exit_["region"] + ("(舊)" if exit_.get("previous") else "")
        for zone in DNSBL:
            keys[f"{label}:{zone}"] = (exit_["ip"], zone)
    results = dict.fromkeys(keys, "unknown")
    pool = ThreadPoolExecutor(max_workers=8)
    futures = {pool.submit(dnsbl_answer, ip, zone): key for key, (ip, zone) in keys.items()}
    try:
        for future in as_completed(futures, timeout=DNSBL_TIMEOUT):
            results[futures[future]] = future.result()
    except FutureTimeout:
        pass
    pool.shutdown(wait=False, cancel_futures=True)
    return results


def dnsbl_change(now: set[str], before: set[str]) -> str:
    lines = [f"- {item.replace(':', ' 節點的出口 IP 列入 ', 1)}" for item in sorted(now - before)]
    lines += [f"- {item.replace(':', ' 節點的出口 IP 移出 ', 1)}" for item in sorted(before - now)]
    hint = ("列入多半是有裝置寄垃圾信、掃描或攻擊其他主機。先看主機商有沒有轉來 abuse 通知，"
            "再照 deploy/README.md 的「濫用的跡象」處理。") if now - before else ""
    return "\n".join(lines) + ("\n\n" + hint if hint else "")


def watch_dnsbl(data: dict) -> None:
    """Notify when an exit address enters or leaves a DNS blocklist. A lookup that failed keeps what was known
    before, so a resolver hiccup does not read as leaving the list. Unlike the sites, the first run notifies:
    an address already listed is worth knowing."""
    results = dnsbl_results(data)
    before = {line for line in DNSBL_STATE.read_text().splitlines() if line} if DNSBL_STATE.exists() else set()
    now = {k for k, v in results.items() if v == "listed"} | {k for k in before if results.get(k) == "unknown"}
    unknown = sorted(k for k, v in results.items() if v == "unknown")
    if unknown:
        print(f"vessel dnsbl: {len(unknown)} 筆查不到結果：{', '.join(unknown)}")
    if now == before and DNSBL_STATE.exists():
        return
    if now != before:
        try:
            notify("Vessel 出口 IP 的黑名單有變化", dnsbl_change(now, before), "high" if now - before else "default",
                   "no_entry" if now - before else "white_check_mark")
        except Exception as err:
            print(f"vessel dnsbl: 推播失敗：{err}", file=sys.stderr)
            return
    DNSBL_STATE.parent.mkdir(parents=True, exist_ok=True)
    DNSBL_STATE.write_text("".join(f"{k}\n" for k in sorted(now)))
    print(f"vessel dnsbl: {len(results)} 筆查詢，列入 {len(now)} 筆" + ("，已推播" if now != before else ""))


if __name__ == "__main__":
    sys.exit(main())
