#!/usr/bin/env python3
"""Vessel 的 worker 停擺提醒。

2026-10-27 worker 跟資料庫的連線斷了，一直拿斷掉的連線重試，一個多小時沒有讀到任何用量，
容器與 API 都是健康的，直到使用者發現用量一直是 0。這支腳本從 cron 定時讀後端的
/internal/health，worker 太久沒有完成一輪、某個節點的用量太久沒有讀到、某個節點的網站自測
太久沒有更新、有工作卡住、檢測用的名單超過一天沒有更新，或後端沒有回應時，推播到 ntfy。

只在狀態改變時推播：開始出問題推一次、問題的組合有變化推一次、恢復再推一次。
上一次的狀態記在 VESSEL_HEALTH_STATE。做法跟 Pulse 的 tools/freshness_warn.py 相同。

節點打不開的網站（某個節點打不開、其他節點打得開，跟服務狀態頁相同）另外比對：有網站新打不開
或恢復時推一則一般優先的通知，上一次的清單記在 VESSEL_REACH_STATE。第一次執行只記下清單，不推播。

各城市的出口 IP 也逐一到 DNS 黑名單（VESSEL_DNSBL）查詢，被列入或移出時推播，上一次的結果記在
VESSEL_DNSBL_STATE。節點不記錄連線的目的地，有裝置寄垃圾信、掃描或攻擊其他主機時，出口 IP 被列入
黑名單是我們看得到的少數訊號之一。

用量與節點計數也另外比對：本月上傳超過下載、照目前的速度月底前會用完額度、已經用完額度的帳號數，
有任何一項變多時推播；節點的 BitTorrent 與連線數上限的計數從 0 變成大於 0 時推播；某個城市今天同時
連不上的裝置達到 FAILING_ALERT 台，或比上次更多時推播。都只有總數，
沒有帳號或裝置，上一次的結果記在 VESSEL_USAGE_STATE。

各節點每小時統計打到 AWG 埠、不是裝置送來的封包（node/host/vessel-probe-watch.sh），worker 收回後端。
某個節點近 24 小時的數字達到 PROBE_SIGNALS 的下限，而且是前 7 天平均的 PROBE_TIMES 倍以上時推播，
回到平常時再推一次，上一次的結果記在 VESSEL_PROBE_STATE。節點超過 3 小時沒有新的一筆時算進異常。

只用標準函式庫，在部署主機上用系統的 python3 執行。

    VESSEL_NTFY=http://<ntfy 主機>/<topic> python3 deploy/health_warn.py

環境變數：
    VESSEL_NTFY            ntfy 的 topic 網址，必填
    VESSEL_HEALTH_URL      預設 http://127.0.0.1:8090/internal/health，埠要跟 deploy/.env 的 VESSEL_API_PORT 一致
    VESSEL_HEALTH_STATE    預設 ~/.cache/vessel-health.state
    VESSEL_REACH_STATE     預設 ~/.cache/vessel-reach.state
    VESSEL_DNSBL           查詢的黑名單，空白分隔，預設見下方的 DNSBL，設成空值就不查
    VESSEL_DNSBL_STATE     預設 ~/.cache/vessel-dnsbl.state
    VESSEL_USAGE_STATE     預設 ~/.cache/vessel-usage.state
    VESSEL_PROBE_STATE     預設 ~/.cache/vessel-probe.state
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
USAGE_STATE = Path(os.environ.get("VESSEL_USAGE_STATE", Path.home() / ".cache" / "vessel-usage.state"))
PROBE_STATE = Path(os.environ.get("VESSEL_PROBE_STATE", Path.home() / ".cache" / "vessel-probe.state"))
# /internal/health probe: what reached a node's port from addresses that are not a device's, over the last 24 hours.
# Each count's label and the least worth a notice. A day's sources add up each hour's, so one removed device whose
# app keeps trying is up to 24 handshake sources a day, and with the 4 to 9 packets a client sends before each
# handshake, every 5 seconds, 90,000 to 170,000 packets; the floors sit above that. They are first guesses from one
# week of counts (toomore/anoni-net-ws#487), to be set again once there are four.
PROBE_SIGNALS = {
    "handshake_sources": ("送出握手長度封包的來源", 30),
    "handshake_china": ("送出握手長度封包、登記在中國的來源", 10),
    "probe_packets": ("不是裝置送來的封包", 500000),
    "china": ("登記在中國的來源", 10),
    "dropped": ("超過額度被丟棄的封包", 1),
}
# and at least this many times the average day of the 7 days before
PROBE_TIMES = 3
# the nodes write a row every hour; three hours without one means the timer stopped or the worker cannot read it
PROBE_STALE = 3 * 3600
# /internal/health usage_flags, and the node totals worth a notice (node/start.sh); new-connections is only for scale
USAGE_FLAGS = {
    "upload": "本月上傳超過下載（上傳至少 1 GB）的帳號",
    "pace": "照目前的速度月底前會用完額度的帳號",
    "quota": "已經用完額度、限速中的帳號",
}
# devices in one city at once that keep trying to connect and never get through (/internal/health failing): one may be a
# single person on a network that blocks the city; from this many, the city may be interfered with
FAILING_ALERT = 2
NODE_SIGNALS = {
    "bt-dht": "BitTorrent DHT 查詢的封包",
    "bt-handshake": "BitTorrent 握手的封包",
    "bt-tracker": "BitTorrent tracker 請求的封包",
    "over-device-limit": "裝置連線數到上限、被拒絕的新連線",
}
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
# 分析主機每 6 小時下載一次比對用的名單（inspect/systemd/vessel-inspect-lists.timer），一天沒有更新代表連續失敗
LISTS_STALE = 24 * 3600


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
    for region, age in sorted(data.get("probe_age", {}).items()):
        if age > PROBE_STALE:
            problems.append(f"probe:{region}")
            who = f"{region.removesuffix('-control')} 的對照主機" if region.endswith("-control") else f"{region} 節點"
            lines.append(f"- {who}：探測的統計 {age // 3600} 小時沒有新的一筆")
    analysis = data.get("analysis_age")
    if analysis is not None and analysis > 1800:
        problems.append("analysis")
        lines.append(f"- 分析主機超過 {analysis // 60} 分鐘沒有回應，檢測中的裝置這段時間沒有資料")
    lists = data.get("lists_age")
    if lists is not None and lists > LISTS_STALE:
        problems.append("lists")
        # a list that was never downloaded is recorded as 1970
        how = "有名單還沒下載過" if lists > 20 * 365 * 86400 else f"最舊的一份 {lists // 3600} 小時沒有更新"
        lines.append(f"- 分析主機比對用的名單：{how}，檢測中的裝置是跟舊名單比對的")
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
    elif state == "lists":
        hint = "在分析主機上看 systemctl status vessel-inspect-lists.timer vessel-inspect-lists.service，手動更新用 analyze.py update-lists。"
    elif "usage:" in state or "jobs" in state:
        hint = "worker 正常但連不上節點：從 m6 經 tailnet 連節點，看 awgctl list 與 worker 的 log。"
    elif "probe:" in state and "reach:" not in state:
        hint = ("節點的探測統計停了，或 worker 讀不到：在節點上看 systemctl status vessel-probe-watch.timer 與 "
                "/opt/vessel-node/host/vessel-probe-watch.sh show，再確認節點的 awgctl-remote 有 probe --csv。"
                "對照主機要經過跳板，跳板停機時也讀不到（deploy/README.md 的「對照主機」）。")
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
        watch_usage(data)
        watch_probe(data)
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



def usage_counts(data: dict) -> dict[str, int]:
    """What to compare between runs: each usage flag's count of accounts, and `region:name` set to 1 for each node
    total worth a notice that is above zero. A node total counts as present or not, so P2P that goes on is told
    once, not every run; it goes back to 0 when the node's container restarts."""
    counts = {k: int(v) for k, v in data.get("usage_flags", {}).items() if k in USAGE_FLAGS}
    for region, node in data.get("node_totals", {}).items():
        for name, value in node.get("counts", {}).items():
            if name in NODE_SIGNALS and value > 0:
                counts[f"{region}:{name}"] = 1
    # today's most at once: told when it reaches FAILING_ALERT and each time it goes higher, back to none the next day
    for region, value in data.get("failing", {}).items():
        if value >= FAILING_ALERT:
            counts[f"{region}:failing"] = int(value)
    return counts


def usage_body(data: dict, now: dict[str, int], before: dict[str, int]) -> str:
    lines = []
    for key, label in USAGE_FLAGS.items():
        if now.get(key):
            change = f"（上次 {before.get(key, 0)} 個）" if now[key] != before.get(key, 0) else ""
            lines.append(f"- {label}：{now[key]} 個{change}")
    for region, node in sorted(data.get("node_totals", {}).items()):
        for name, label in NODE_SIGNALS.items():
            if f"{region}:{name}" in now:
                fresh = "，新出現" if f"{region}:{name}" not in before else ""
                lines.append(f"- {region} 節點的{label}：{node['counts'][name]} 次（節點 {node['since'][:16]} UTC 啟動以來{fresh}）")
    for region, value in sorted(data.get("failing", {}).items()):
        if f"{region}:failing" in now:
            lines.append(f"- {region} 節點：今天同時有 {value} 台裝置一直嘗試連線卻連不上（節點收得到，連線沒有建立）")
    return "\n".join(lines) + ("\n\n只有總數。帳號的細節在 m6 上查 account_usage，"
                               "處理方式見 deploy/README.md 的「濫用的跡象」。")


def watch_usage(data: dict) -> None:
    """Notify when any count of unusual accounts goes up, or a node total worth a notice turns up. Counts going down
    (a new month, a node restart) are only remembered. A failed notice leaves the state as it was, to try again."""
    if "usage_flags" not in data:
        return  # a backend from before the flags
    now = usage_counts(data)
    before = {}
    if USAGE_STATE.exists():
        for line in USAGE_STATE.read_text().splitlines():
            key, _, value = line.partition("=")
            if value.isdigit():
                before[key] = int(value)
    risen = sorted(k for k, v in now.items() if v > before.get(k, 0))
    if risen:
        try:
            notify("Vessel 用量或節點計數有異常", usage_body(data, now, before), "default", "mag")
        except Exception as err:
            print(f"vessel usage: 推播失敗：{err}", file=sys.stderr)
            return
        print(f"vessel usage: {', '.join(risen)} 增加，已推播")
    if now != before or not USAGE_STATE.exists():
        USAGE_STATE.parent.mkdir(parents=True, exist_ok=True)
        USAGE_STATE.write_text("".join(f"{k}={v}\n" for k, v in sorted(now.items())))


def probe_raised(data: dict) -> set[str]:
    """`region:count` for each count that is at its floor over the last 24 hours and PROBE_TIMES its usual day. A
    count the node does not have, or with too few days before it to compare with, raises nothing."""
    raised = set()
    for region, level in data.get("probe", {}).items():
        for name, (_, floor) in PROBE_SIGNALS.items():
            day, usual = level.get("day", {}).get(name), level.get("usual", {}).get(name)
            if day is not None and usual is not None and day >= floor and day >= PROBE_TIMES * usual:
                raised.add(f"{region}:{name}")
    return raised


def probe_body(data: dict, now: set[str], before: set[str]) -> str:
    """Each raised count with its usual day and the other nodes' same count: a rise on every node at once is mostly
    a scan of the whole network, a rise on one node is the one to look into. Where the node has a control, a host
    without Vessel in the same place, its same count follows: what any host there got that day."""
    levels, lines = data.get("probe", {}), []
    for key in sorted(now):
        region, name = key.split(":", 1)
        others = "、".join(f"{r} {v['day'][name]}" for r, v in sorted(levels.items())
                          if r != region and v.get("day", {}).get(name) is not None)
        fresh = "" if key in before else "，新出現"
        lines.append(f"- {region} 節點近 24 小時{PROBE_SIGNALS[name][0]}：{levels[region]['day'][name]}"
                     f"（前 7 天平均每天 {levels[region]['usual'][name]}{fresh}）" + (f"，其他節點：{others}" if others else "")
                     + (f"，對照主機：{beside}" if (beside := levels[region].get("control", {}).get(name)) is not None else ""))
    for key in sorted(before - now):
        region, name = key.split(":", 1)
        if name in PROBE_SIGNALS:
            lines.append(f"- {region} 節點的{PROBE_SIGNALS[name][0]}回到平常")
    return "\n".join(lines) + ("\n\n只有總數，沒有位址。每天與每小時的數字在 m6 上用 python -m app.admin probes 查，"
                               "判讀見 node/README.md 的「探測與掃描的觀察」。")


def watch_probe(data: dict) -> None:
    """Notify when a node's probe counts rise well above their usual level, and when they are back. A failed notice
    leaves the state as it was, to try again."""
    if "probe" not in data:
        return  # a backend from before the counts
    now = probe_raised(data)
    before = {line for line in PROBE_STATE.read_text().splitlines() if line} if PROBE_STATE.exists() else set()
    if now == before:
        return
    try:
        notify("Vessel 節點被探測的數字有變化", probe_body(data, now, before), "high" if now - before else "default",
               "eyes" if now - before else "white_check_mark")
    except Exception as err:
        print(f"vessel probe: 推播失敗：{err}", file=sys.stderr)
        return
    PROBE_STATE.parent.mkdir(parents=True, exist_ok=True)
    PROBE_STATE.write_text("".join(f"{k}\n" for k in sorted(now)))
    print(f"vessel probe: {len(before)} → {len(now)} 項，已推播")


if __name__ == "__main__":
    sys.exit(main())
