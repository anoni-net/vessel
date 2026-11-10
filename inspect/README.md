# inspect

裝置流量檢測的分析端，規劃見 toomore/anoni-net-ws#480。節點把開啟檢測的裝置的封包送過來，這裡自動分析，分析完就刪除封包，只留下每台裝置的統計與命中名單的項目。

```
節點 awgctl inspect → NFLOG 群組 42 → vessel-inspect-stream → Tailscale → recv.py → spool/ → analyze.py batch → state/
```

| 檔案 | 內容 |
|---|---|
| `recv.py` | 接收節點的串流，切成 spool 檔案，寫完才改成正式檔名 |
| `analyze.py` | 用 Zeek 分析封包、累計到每台裝置，封包隨即刪除，也負責更新名單、輸出結果與清除資料 |
| `systemd/` | 接收服務與每 5 分鐘分析一次的計時器 |

節點端的 `node/host/vessel-inspect-stream.sh` 在容器的網路空間讀 NFLOG，由主機上的 `vessel-inspect-send.py` 開連線送出，走主機本來就有的 Tailscale。分析主機關閉連線、當機或斷網時，一分鐘內服務會結束並重新連線。節點的 `node.env` 沒有設定 `INSPECT_SINK` 時，服務不會做任何事。

## 留下什麼

| 留下 | 不留下 |
|---|---|
| 每小時的上傳與下載量 | 封包（分析後刪除，失敗的 1 天後刪除） |
| DNS 查詢的總數、查無此網域（節點的名單擋下的不算）與廣告追蹤的比例 | 造訪過的網站與查詢過的網域 |
| 命中名單的網域、造訪次數、第一次與最後一次的時間、出現過的小時，以及它同時列在哪幾份名單上 | 查無此網域的名稱 |
| 繞過節點 DNS 的次數 | Zeek 的紀錄 |

命中名單的網域以名單上的項目為單位，同一個項目底下的子網域併成一筆。次數以造訪計算，一次造訪會用 A、AAAA、HTTPS 查詢同一個名字，再用 SNI 連線，所以同一個項目距離上一次計入不到 60 秒的紀錄不再計入，不分 DNS、SNI 或 HTTP。出現過的小時以 UTC 記錄，用來分辨只出現一次與反覆出現。每筆命中另外記下它列在哪幾份名單上（`stalkerware`、`malware`、`cti`、`ads`，一定包含自己那份），用實際查詢或連線的名稱逐一比對四份名單，同一個項目底下的子網域與不同批次取聯集。報告用它寫出「也列在廣告與追蹤名單上」，資訊取自名單本身，不另外蒐集資料。報告每種類別列出次數最多的 30 筆，其餘只留下數量，總次數仍然完整。

系統與私有網路的查詢不計入 DNS 的統計，也不比對名單：`.arpa`（反查、iOS 的 Bonjour 與 DDR）、`.local`、`.localdomain`、`.internal`、`.lan`、`.home`、`.invalid`、`.test`、`.onion`、Tailscale 的 `.ts.net`，以及沒有點的名稱。這些查詢跟裝置連往的網站無關，多半本來就查不到，名稱又會透露使用者自己的網路，留著只會把查無此網域的比例拉高。

報告不列瀏覽紀錄，取得別人手機的人才不會藉此得知對方連了哪些網站。流量由封包表頭的長度計算，封包被截斷時仍然準確，Zeek 對 QUIC 的流量統計在截斷時會低估。

入口網站取得的報告是用使用者瀏覽器產生的 X25519 公鑰加密的（`report --seal`），入口網站的資料庫存的只有密文。

`clear` 刪除某台裝置的結果，通道位址重複使用時，新的檢測要從空的開始。

## 入口網站的呼叫

入口網站用 SSH 連到分析主機，金鑰綁定 `inspect-remote`，只能取得加密的報告、清除結果、查詢狀態，以及在檢測結束時要 `recv.py` 立刻切檔：

```
command="/opt/vessel-inspect-app/inspect-remote",restrict,from="<入口主機的 tailnet IP>" ssh-ed25519 AAAA... vessel-portal
```

## 安裝

分析主機需要 Docker、Python 3、`python3-cryptography` 與 Tailscale，節點需要 `tcpdump`，以及 `node/README.md` 的「裝置檢測」。

```bash
# 分析主機
install -d /opt/vessel-inspect-app; cp inspect/recv.py inspect/analyze.py inspect/inspect-remote node/exclude.txt /opt/vessel-inspect-app/
printf 'VESSEL_INSPECT_LISTEN=<tailnet IP>:9400\nVESSEL_INSPECT_HOME=/var/lib/vessel-inspect\nVESSEL_INSPECT_EXCLUDE=/opt/vessel-inspect-app/exclude.txt\n' > /etc/vessel-inspect.env
install -d -m 700 /var/lib/vessel-inspect
python3 -I /opt/vessel-inspect-app/analyze.py update-lists
cp inspect/systemd/* /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now vessel-inspect-recv.service vessel-inspect-batch.timer

# 節點：node.env 加上 INSPECT_SINK=<分析主機的 tailnet IP>:9400
cp node/host/vessel-inspect-stream.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vessel-inspect-stream.service
```

名單用排程執行 `analyze.py update-lists` 更新，下載失敗時保留上一份。
