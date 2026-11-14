# inspect

裝置流量檢測的分析端，規劃見 toomore/anoni-net-ws#480。節點把開啟檢測的裝置的封包送過來，這裡自動分析，分析完就刪除封包，只留下每台裝置的統計與命中名單的項目。

```
節點 awgctl inspect → NFLOG 群組 42 → vessel-inspect-stream → Tailscale → recv.py → spool/ → analyze.py batch → state/
```

| 檔案 | 內容 |
|---|---|
| `recv.py` | 接收節點的串流，切成 spool 檔案，寫完才改成正式檔名 |
| `analyze.py` | 用 Zeek 分析封包、累計到每台裝置，封包隨即刪除，也負責更新名單、輸出結果與清除資料 |
| `systemd/` | 接收服務、每 5 分鐘分析一次的計時器，以及每 6 小時更新名單的計時器 |

節點端的 `node/host/vessel-inspect-stream.sh` 在容器的網路空間讀 NFLOG，由主機上的 `vessel-inspect-send.py` 開連線送出，走主機本來就有的 Tailscale。分析主機關閉連線、當機或斷網時，一分鐘內服務會結束並重新連線。節點的 `node.env` 沒有設定 `INSPECT_SINK` 時，服務不會做任何事。

`recv.py` 只接收 `VESSEL_INSPECT_NODES` 列出的節點，格式是空白分隔的 `<名稱>=<tailnet IP>`。名稱是入口網站裡城市的代號，也是節點連線時第一行報上的名稱（`node.env` 的 `INSPECT_NAME`，沒有設定時是主機名稱）。連線的來源位址不在清單裡，或報上的名稱跟清單裡那個位址的名稱不同，連線會直接關閉，不寫入任何東西。沒有設定 `VESSEL_INSPECT_NODES` 時服務不會啟動。新增節點或節點換主機時，要更新這個清單並重啟 `vessel-inspect-recv.service`。

## 留下什麼

| 留下 | 不留下 |
|---|---|
| 每小時的上傳與下載量 | 封包（分析後刪除，失敗的 1 天後刪除） |
| 連往廣告與追蹤服務的流量總數 | 是哪些服務、什麼時候 |
| DNS 查詢的總數、查無此網域（節點的名單擋下的不算）與廣告追蹤的比例 | 造訪過的網站與查詢過的網域 |
| 命中名單的網域或伺服器位址、造訪次數、第一次與最後一次的時間、出現過的小時、它同時列在哪幾份名單上，以及跟蹤軟體命中所屬的 App 名稱 | 查無此網域的名稱 |
| 繞過節點 DNS 的次數，包含連往加密 DNS 伺服器的連線數 | Zeek 的紀錄 |
| 沒有加密的網頁連線（明文 HTTP）的次數 | 沒有加密的連線連往哪裡、什麼時候 |
| 使用舊版加密（SSL、TLS 1.0、1.1）的連線次數 | 這些連線連往哪裡、什麼時候 |

命中名單的網域以名單上的項目為單位，同一個項目底下的子網域併成一筆。次數以造訪計算，一次造訪會用 A、AAAA、HTTPS 查詢同一個名字，再用 SNI 連線，所以同一個項目距離上一次計入不到 60 秒的紀錄不再計入，不分 DNS、SNI 或 HTTP。出現過的小時以 UTC 記錄，用來分辨只出現一次與反覆出現。每筆命中另外記下它列在哪幾份名單上（`spyware`、`stalkerware`、`malware`、`cti`、`ads`，一定包含自己那份），用實際查詢或連線的名稱逐一比對五份名單，同一個項目底下的子網域與不同批次取聯集。報告用它寫出「也列在廣告與追蹤名單上」，資訊取自名單本身，不另外蒐集資料。跟蹤軟體的命中另外記下它屬於哪個 App（`app`），取自 Echap 的 [stalkerware-indicators](https://github.com/AssoEchap/stalkerware-indicators) 的 `generated/network.csv`，只用 `type` 是網域的列，以比對到的最具體的網域為準，表裡沒有就不記。這份表以 CC BY 4.0 授權，報告頁附上出處。報告每種類別列出次數最多的 30 筆，其餘只留下數量，總次數仍然完整。

系統與私有網路的查詢不計入 DNS 的統計，也不比對名單：`.arpa`（反查、iOS 的 Bonjour 與 DDR）、`.local`、`.localdomain`、`.internal`、`.lan`、`.home`、`.invalid`、`.test`、`.onion`、Tailscale 的 `.ts.net`，以及沒有點的名稱。這些查詢跟裝置連往的網站無關，多半本來就查不到，名稱又會透露使用者自己的網路，留著只會把查無此網域的比例拉高。

跟蹤軟體另外用伺服器位址比對。Echap 的 `network.csv` 除了網域，也列出只知道位址的伺服器（`type` 是 `ipv4` 的列），裝置不查詢名稱、直接連往這些位址時，用名稱比對不到。連線的目的位址在表上就記成一筆命中，名稱是那個位址，`how` 是 `IP`，App 名稱取自同一列。同一台裝置 60 秒內已經有同一類的名稱命中時，位址視為同一次造訪，不另外列出。私有與保留的位址不讀進來，沒有列在表上的位址不留下。只比對跟蹤軟體：惡意網站的 IP 名單收錄大量被入侵的一般主機，P2P 連線會大量誤判，所以不用。

間諜軟體（`spyware`）比對的是 Pegasus、Predator 這類針對特定對象的監控工具，指標取自 [Mobile Verification Toolkit 的 mvt-indicators](https://github.com/mvt-project/mvt-indicators)。它的 `indicators.yaml` 列出每項調查的 STIX2 檔案，`update-lists` 逐一下載，取出網域與 IPv4 位址，寫成 `lists/spyware.csv`（`type,indicator,app`，`app` 是調查的名稱）。索引裡 Echap 的跟蹤軟體已經另外比對，略過不讀。索引只接受 GitHub 上的檔案，路徑裡有其他字元時整份下載失敗。任何一項調查下載失敗時保留上一份，不會只剩一部分。命中跟跟蹤軟體一樣是已知威脅，排在最前面，`app` 記下指標出自哪一項調查，位址也照上一段的方式比對。這些指標是調查公開當時的紀錄，伺服器經常更換，舊的網域也可能換人使用（2026-11-12 約 5,000 個網域裡有 55 個同時列在廣告或跟蹤軟體名單上），報告頁寫明無法據此確認裝置是否被監控，並請使用者聯絡 Access Now 的數位安全求助專線。

繞過節點 DNS 的次數有兩種來源。連往節點以外的 53 與 853 埠算一次。連往加密 DNS 伺服器（DoH，走 443 埠）的連線也算一次，伺服器取自 HaGeZi 的 [Encrypted DNS 名單](https://github.com/hagezi/dns-blocklists)：連線的 SNI 在名單上，或連線沒有 SNI、目的位址在名單的 IP 清單上。位址上有 SNI 而名稱不在名單時不算，那可能是同一台主機上的其他網站。只留下次數，不留下是哪一台伺服器。Apple 自己的解析器與 iCloud Private Relay（`apple.com`、`aaplimg.com`、`icloud.com` 與 `17.0.0.0/8`）也在那份名單上，iPhone 會自行連線，使用者沒有設定可以檢查，所以排除。

每筆命中另外記下被 Vessel 擋下的造訪次數（`blocked`）。節點的過濾名單擋下的查詢，回應裡帶著跟其他回應不同的標記（`blocked_answers()`，跟節點計算擋下次數的方式相同）。一次造訪裡的查詢全部被擋下才算擋下，其中有一筆查詢得到位址，或有 SNI、HTTP、位址的連線，就算沒有擋下，代表裝置從別處取得了位址或已經連上。裝置沒有開啟網域過濾，或網站不在節點的過濾名單上（間諜軟體的指標就不在），次數都是 0。開始計算之前已經在進行的檢測，舊的命中沒有這個欄位，報告也不寫。這個數字不進負責人的摘要。

沒有加密的網頁連線以 Zeek 的 `http.log` 計算，同一條連線的多個請求只算一次，只留下次數。系統自己送出、本來就不加密的連線不算：查詢憑證狀態的 OCSP 與 CRL（第一段名稱是 `ocsp`、`crl` 加上數字，以及 Let's Encrypt、Google 的憑證主機），以及偵測 Wi-Fi 登入頁的連線（`PLAIN_SYSTEM_HOSTS` 與 `PLAIN_SYSTEM_PATHS`）。開始計算之前已經在進行的檢測，報告不寫這一項。這個數字不進負責人的摘要。

使用舊版加密的連線以 Zeek 的 `ssl.log` 計算，看連線最後採用的版本（`version` 是 `SSLv2`、`SSLv3`、`TLSv10` 或 `TLSv11`），每條連線算一次，只留下次數。DTLS 的版本編號不同，不算在內。握手在每條連線前 12 個完整複製的封包裡，截斷不影響。開始計算之前已經在進行的檢測，報告不寫這一項，負責人的摘要也沒有。

連往廣告與追蹤服務的流量取自 Zeek `conn.log` 的 `orig_ip_bytes` 與 `resp_ip_bytes`，跟每小時的流量一樣是 IP 表頭裡的長度，封包截斷時不會少算。連線的名稱依序看 SNI、HTTP 的 Host，沒有時用同一批 DNS 查詢回答的位址對回查詢的名稱，名稱在廣告名單上就計入。查詢在更早的批次、被裝置快取的連線對不到名稱，比例只會偏低。只留下位元組數，報告輸出它占全部流量的比例（`ads_traffic_share`）。選擇擋廣告與追蹤的裝置，查詢在節點就被擋下，比例接近 0 是正常的。開始計算之前已經在進行的檢測，報告不寫這一項，負責人的摘要也沒有。

報告不列瀏覽紀錄，取得別人手機的人才不會藉此得知對方連了哪些網站。流量由封包表頭的長度計算，封包被截斷時仍然準確，Zeek 對 QUIC 的流量統計在截斷時會低估。

分析只看 IPv4。節點不轉送通道裡的 IPv6（`node/README.md` 的「IPv6 一律拒絕」），裝置經過 Vessel 的連線都是 IPv4。

入口網站取得的報告是用使用者瀏覽器產生的 X25519 公鑰加密的（`report --seal`），入口網站的資料庫存的只有密文。

團體的負責人提出、成員同意的檢測，另外替每位負責人產生一份摘要（`summary --seal`，規劃見 toomore/anoni-net-ws#483），用負責人瀏覽器產生的公鑰加密。摘要只有判定（`clean`、`check`、`threat`，跟報告頁的判定相同）、命中的類別與嚴重程度，以及涵蓋率（有連線的小時數與總小時數），不含網域、次數、出現的時段、第一筆與最後一筆資料的時間，以及流量。加密時 HKDF 的 `info` 用 `vessel-inspection-summary`，跟報告分開，摘要無法被當成報告打開。

`clear` 刪除某台裝置的結果，通道位址重複使用時，新的檢測要從空的開始。

## 入口網站的呼叫

入口網站用 SSH 連到分析主機，金鑰綁定 `inspect-remote`，只能取得加密的報告與負責人的摘要、清除結果、查詢狀態，以及在檢測結束時要 `recv.py` 立刻切檔：

```
command="/opt/vessel-inspect-app/inspect-remote",restrict,from="<入口主機的 tailnet IP>" ssh-ed25519 AAAA... vessel-portal
```

## 安裝

分析主機需要 Docker、Python 3、`python3-cryptography` 與 Tailscale，節點需要 `tcpdump`，以及 `node/README.md` 的「裝置檢測」。

```bash
# 分析主機
install -d /opt/vessel-inspect-app; cp inspect/recv.py inspect/analyze.py inspect/inspect-remote node/exclude.txt /opt/vessel-inspect-app/
printf 'VESSEL_INSPECT_LISTEN=<tailnet IP>:9400\nVESSEL_INSPECT_NODES=sg=<sg 節點的 tailnet IP> jp=<jp 節點的 tailnet IP>\nVESSEL_INSPECT_HOME=/var/lib/vessel-inspect\nVESSEL_INSPECT_EXCLUDE=/opt/vessel-inspect-app/exclude.txt\n' > /etc/vessel-inspect.env
install -d -m 700 /var/lib/vessel-inspect
python3 -I /opt/vessel-inspect-app/analyze.py update-lists
cp inspect/systemd/* /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now vessel-inspect-recv.service vessel-inspect-batch.timer vessel-inspect-lists.timer

# 節點：node.env 加上 INSPECT_SINK=<分析主機的 tailnet IP>:9400
cp node/host/vessel-inspect-stream.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vessel-inspect-stream.service
```

## 名單的更新

`vessel-inspect-lists.timer` 每 6 小時執行一次 `analyze.py update-lists`（UTC 05:40、11:40、17:40、23:40，各延後最多 10 分鐘），主機當時關機的話開機後補做。四份名單之外也下載跟蹤軟體的 App 名稱表（`lists/stalkerware-apps.csv`），加密 DNS 伺服器的名稱與位址（`lists/doh.txt`、`lists/doh-ips.txt`），以及間諜軟體的指標（`lists/spyware.csv`）。某一份下載失敗時保留上一份，其他照常更新，指令以失敗結束，`systemctl status vessel-inspect-lists.service` 看得到是哪一份。沒有 App 名稱表時照常分析，只是報告不寫 App 名稱。沒有加密 DNS 伺服器的名單時，只算 53 與 853 埠。沒有間諜軟體的指標時，那一項不比對。

封包只跟分析當下的名單比對，分析完就刪除，名單停止更新的那段時間事後無法補比對。所以名單的時間有兩處看得到：

- `status` 回報最舊一份名單的下載時間（`lists_at`，有名單還沒下載時是 `null`）。有裝置在檢測時，worker 把它記下來，`deploy/health_warn.py` 在超過 24 小時沒有更新時推播
- 報告帶著產生當下的 `lists_at`，報告頁寫出名單更新的時間，超過一天時提醒這段期間新增的網站沒有比對到
