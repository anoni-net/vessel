#!/usr/bin/env python3
"""Vessel 的 worker 停擺提醒。

2026-10-27 worker 跟資料庫的連線斷了，一直拿斷掉的連線重試，一個多小時沒有讀到任何用量，
容器與 API 都是健康的，直到使用者發現用量一直是 0。這支腳本從 cron 定時讀後端的
/internal/health，worker 太久沒有完成一輪、某個節點的用量太久沒有讀到、有工作卡住，
或後端沒有回應時，推播到 ntfy。

只在狀態改變時推播：開始出問題推一次、問題的組合有變化推一次、恢復再推一次。
上一次的狀態記在 VESSEL_HEALTH_STATE。做法跟 Pulse 的 tools/freshness_warn.py 相同。

只用標準函式庫，在部署主機上用系統的 python3 執行。

    VESSEL_NTFY=http://<ntfy 主機>/<topic> python3 deploy/health_warn.py

環境變數：
    VESSEL_NTFY            ntfy 的 topic 網址，必填
    VESSEL_HEALTH_URL      預設 http://127.0.0.1:8090/internal/health，埠要跟 deploy/.env 的 VESSEL_API_PORT 一致
    VESSEL_HEALTH_STATE    預設 ~/.cache/vessel-health.state
    --force                不管狀態有沒有變都推播一次，用來測試通知
"""

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

URL = os.environ.get("VESSEL_HEALTH_URL", "http://127.0.0.1:8090/internal/health")
NTFY = os.environ.get("VESSEL_NTFY", "")
STATE = Path(os.environ.get("VESSEL_HEALTH_STATE", Path.home() / ".cache" / "vessel-health.state"))

# the worker finishes a round every 10 seconds and reads the nodes every 5 minutes
WORKER_STALE = 5 * 60
USAGE_STALE = 20 * 60


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
    if data.get("stuck_jobs"):
        problems.append("jobs")
        lines.append(f"- 有 {data['stuck_jobs']} 個節點工作排隊超過 15 分鐘")
    return (",".join(problems) or "ok"), lines


def check() -> tuple[str, str]:
    try:
        with urllib.request.urlopen(URL, timeout=30) as resp:
            data = json.load(resp)
    except Exception as err:  # 連不上、5xx、逾時都算後端沒有回應
        return "api-down", f"{URL} 沒有回應：{err}\n\n先看 sudo docker compose ps 與 api 的 log。"
    state, lines = evaluate(data)
    if state == "ok":
        return state, "worker 與各節點的用量讀取都正常。"
    if "worker" in state:
        hint = "worker 停了或連不上資料庫：sudo docker compose logs --tail 50 worker，必要時 restart worker。"
    else:
        hint = "worker 正常但連不上節點：從 m6 經 tailnet 連節點，看 awgctl list 與 worker 的 log。"
    return state, "\n".join(lines) + "\n\n" + hint


def notify(title: str, body: str, priority: str, tags: str) -> None:
    # 標題有中文，HTTP 標頭只能放 latin-1，改用 ntfy 的查詢參數
    query = urllib.parse.urlencode({"title": title, "priority": priority, "tags": tags})
    req = urllib.request.Request(f"{NTFY}?{query}", data=body.encode(), method="POST")
    urllib.request.urlopen(req, timeout=15).read()


def main() -> int:
    if not NTFY:
        print("VESSEL_NTFY 沒有設定", file=sys.stderr)
        return 2
    force = "--force" in sys.argv[1:]
    state, body = check()
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


if __name__ == "__main__":
    sys.exit(main())
