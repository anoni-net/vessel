# node

Vessel 的節點。每台主機執行一個容器 `vessel-node`，裡面是 AmneziaWG 3.1 與三個 unbound 解析器，裝在主機的 `/opt/vessel-node/`。

## 檔案

| 檔案 | 放在主機的 | 用途 |
|---|---|---|
| `Dockerfile`、`start.sh` | `build/` | 官方 `amneziavpn/amneziawg-go` 映像加上 unbound 與 iptables。`start.sh` 起 AWG、加 DNS 位址、設防火牆、起三個 unbound |
| `setup.sh` | 根目錄 | 一次性安裝：建映像、產生伺服器金鑰與共用參數、下載名單、設 cron、啟動容器。已經有 `server/interface.conf` 就中止 |
| `run.sh` | 根目錄 | 重建容器 |
| `awgctl` | 根目錄，連結到 `/usr/local/sbin/awgctl` | 管理使用者 |
| `update-lists.sh` | 根目錄 | 更新 RPZ 名單（165 的 CSV 先轉成 RPZ），網域有變才重新載入 unbound。root 的 cron 每 8 小時執行（UTC 04:37、12:37、20:37），跟 HaGeZi 名單標示的有效期限一致 |
| `unbound/*.conf` | `unbound/` | 三個解析器的設定 |
| `node.env.example` | 複製成 `node.env` | 節點的公開 IP 與 AWG 的埠，不進 repo |
| `host/99-vessel-node.conf` | `/etc/sysctl.d/` | 主機的核心參數，見「主機的調校」 |
| `host/vessel-net-tune.sh`、`host/vessel-net-tune.service` | `host/`，服務放 `/etc/systemd/system/` | 開機時調整對外網卡的佇列與 UDP 轉送，見「主機的調校」 |

主機上另外有 `server/`（伺服器私鑰與 `HeaderProtectionKey`）、`peers/`、`clients/`、`conf/awg0.conf` 與 `rpz/`，都不進 repo。

## 安裝

需要 Docker 與 Python 3。雲端防火牆只開 AWG 的 UDP 埠，SSH 限定來源。

```bash
mkdir -p /opt/vessel-node/build /opt/vessel-node/unbound
# 把 Dockerfile、start.sh 放進 build/，unbound/*.conf 放進 unbound/，其他檔案放在根目錄
cp node.env.example /opt/vessel-node/node.env   # 填上 NODE_IP 與 LISTEN_PORT
bash /opt/vessel-node/setup.sh
```

接著套用主機的調校（見下一節）。

## 主機的調校

雲端映像的預設值是給一般主機用的，VPN 節點要轉送很多人的流量，調整三件事。都可以在線上直接套用，不必重啟容器，使用者不會斷線：

- 對外網卡的佇列改成 `fq_codel`：雲端映像留著 `pfifo_fast`，所有封包排同一個隊。有人大量下載時，其他人的網頁與 DNS 封包會排在後面。`fq_codel` 每條連線各自排隊，短小的封包先過
- 開啟網卡的 `rx-udp-gro-forwarding`：VPN 的 UDP 封包經 Docker 轉送，合併之後每個封包的 CPU 負擔比較低
- `vm.swappiness` 調到 10：解析器的名單佔約 1 GB 記憶體，換到 swap 的話，查詢會突然變慢

UDP 的 socket 緩衝不用調，`amneziawg-go` 有 `NET_ADMIN`，會自己強制取得它要的大小。

```bash
install -m 644 host/99-vessel-node.conf /etc/sysctl.d/99-vessel-node.conf && sysctl --system
install -m 644 host/vessel-net-tune.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vessel-net-tune.service
```

確認：`tc qdisc show dev <網卡>` 的第一行是 `fq_codel`，`ethtool -k <網卡> | grep rx-udp-gro-forwarding` 是 `on`，`sysctl vm.swappiness` 是 10。

## 管理使用者

```bash
awgctl list [--json]                          # 名稱、過濾選項、隧道 IP、最後握手、流量
awgctl add <名稱> [none|malware|ads]          # 由節點產生金鑰，設定檔寫在 clients/
awgctl add-pubkey <ID> <公鑰> <PSK> [過濾]     # 入口網站用，金鑰在瀏覽器產生
awgctl usage --json                           # 流量計數與介面啟動的時間
awgctl suspend <名稱>                         # 額度用完：peer 下線，金鑰留在節點
awgctl resume <名稱>                          # 恢復暫停的 peer
awgctl show <名稱>
awgctl remove <名稱>
```

增刪使用者用 `awg syncconf` 套到執行中的介面，不會中斷其他人。隧道位址從 `.2` 配到 `.249`，`.250` 到 `.254` 保留給節點自己。

`add-pubkey` 回傳 JSON，內容是設定檔除了私鑰以外的全部欄位（`interface` 與 `peer` 兩組），入口網站在瀏覽器裡補上私鑰組成設定檔。節點上不會留下這個使用者的設定檔。`Jc`、`Jmin`、`Jmax` 與 `I1` 只在客戶端作用，每個使用者各自隨機產生。`I1` 偽裝成 QUIC v1 的 Initial 封包，與節點使用的 UDP 443 一致。開頭幾個位元組符合 QUIC 的格式，DCID 與後面的內容每次握手重新隨機產生，封包大小在 1200 到 1252 位元組之間，依使用者固定。已經建立的設定檔維持原本的 `I1`，重新建立裝置才會換成新的。

`usage --json` 的計數在容器重啟時歸零，`interface_started` 讓呼叫端判斷要不要重新累計。

`suspend` 把 peer 的設定搬到 `suspended/`，`resume` 再搬回來。入口網站把 PresharedKey 交給節點之後就不保存，所以暫停與恢復都在節點上完成。兩個指令重複執行都不會出錯，`remove` 也會清掉暫停中的 peer。

## 入口網站的金鑰

入口網站經 tailnet 用 SSH 呼叫節點，那把金鑰在節點上綁定 `awgctl-remote`，只能執行 `add-pubkey`、`remove`、`suspend`、`resume`、`list --json`、`usage --json`，參數數量不對、要開 shell 或執行其他指令都會被拒絕。把 `awgctl-remote` 放到 `/usr/local/sbin/`，root 的 `authorized_keys` 加上：

```
command="/usr/local/sbin/awgctl-remote",restrict,from="<入口網站主機的 tailnet IP>" ssh-ed25519 AAAA... vessel-portal
```

## DNS 與過濾

| 位址 | 選項 | 名單 |
|---|---|---|
| `10.8.1.1` | 不過濾 | 無 |
| `10.8.1.253` | 擋惡意網站 | [HaGeZi](https://github.com/hagezi/dns-blocklists) Threat Intelligence Feeds（mini），加上 165 停止解析的涉詐網站 |
| `10.8.1.254` | 再擋廣告 | 上面兩份，加上 HaGeZi Multi PRO |

三個 unbound 都不記錄查詢，開 DNSSEC 驗證與 QNAME 最小化，只接受隧道內的查詢。三份名單載入後約佔 1 GB 記憶體，節點至少要 2 GB，並準備 1 GB 以上的 swap，重新載入名單時用量會短暫升高。

擋廣告的名單原本用 Multi（Normal），2026-10-31 改成 HaGeZi 建議的 PRO。比對一個家用網路 Pi-hole 近 7 天擋下最多的 300 個網域，Normal 涵蓋其中 16.5% 的擋下次數，PRO 涵蓋 30.3%。Pi-hole 擋下而 PRO 沒有擋的，多半是定位、iCloud、憑證、視訊通話的 STUN 這類擋了會壞掉功能的服務，不適合放在大家共用的服務上。

### 165 停止解析的涉詐網站

台灣的電信業者依《詐欺犯罪危害防制條例》第 42 條，對刑事警察局列管的涉詐網站停止解析，HiNet 的 DNS 對這些網域回封鎖頁的 IP。連上 Vessel 之後查詢改走節點的解析器，少了這層保護，而 HaGeZi 的名單幾乎沒有收這些網域（2026-10-31 比對 8.6 萬個網域，完整的 TIF 只涵蓋 0.2%）。所以兩個有過濾的解析器另外載入這份名單（toomore/anoni-net-ws#446）。

- 來源是警政署在政府資料開放平台公布的[165反詐騙諮詢專線_遭停止解析涉詐網站](https://data.gov.tw/dataset/176455)，政府資料開放授權條款第 1 版，CSV 格式，不定期更新，資料約落後一個月
- `update-lists.sh` 下載 CSV，取出網域，清掉前面的協定與雜字，格式不對的捨棄，產生 `rpz/tw165.rpz`。每個網域連同子網域回 NXDOMAIN。清單裡沒有短網址、免費架站平台這類共用的上層網域，只有它們底下的子網域，擋子網域不會波及其他網站
- 開 `rpz-signal-nxdomain-ra`，擋下的次數算進詐騙與惡意網站
- 兩個解析器各多約 110 MB 記憶體（2026-10-31 在 unbound 1.25 實測，8.6 萬個網域）
- 名單只照資料集的內容，資料集刪掉的網域，下次更新時就不再擋

### 擋下次數

裝置頁顯示每台裝置本月有幾次查詢被名單擋下，擋惡意網站的裝置只算惡意網站的名單，擋廣告的裝置兩份名單都算。節點只計數，不記錄網域。2026-10-31 以前廣告名單擋下的不算，使用者開了最高的過濾卻只看到個位數，以為過濾沒在運作。

兩份名單分開計數，每月的防護成績單（toomore/anoni-net-ws#445）要分別列出「詐騙與惡意網站」與「廣告與追蹤」：

- 惡意網站的名單開了 `rpz-signal-nxdomain-ra`，擋下的回應是清掉 RA 旗標的 NXDOMAIN，一般的回應不會這樣。`start.sh` 的 `VESSEL-BLOCKED` 用 `u32` 比對 DNS 標頭
- 廣告的名單用 `rpz-action-override: cname`，擋下的回應是指向 `blocked.vessel.` 的 CNAME，這個名稱由 `ads.conf` 的 `local-zone` 回 NXDOMAIN，不會往外查。`VESSEL-ADS` 從第 41 個位元組開始比對：有些裝置收到 CNAME 之後會再查一次 `blocked.vessel.` 本身，這時名稱在問題區段的開頭（第 40 個位元組），從第 41 個位元組開始比對就不會把同一次擋下算兩次。2026-10-31 的東京節點上，這類回應佔了 `VESSEL-ADS` 的三分之二。`VESSEL-ADS` 用 `string` 比對回應裡的這個名稱

兩條 chain 都是每個隧道位址（`.2` 到 `.249`）一條規則，只累計封包數。兩份名單都有的網域，擋廣告的解析器先比對惡意網站的名單，只算在惡意網站那邊。

三個解析器開了 `extended-statistics`，`unbound-control stats_noreset` 的 `num.rpz.action.*` 是整個解析器擋下的總次數，用來比較換名單前後的差別，沒有網域也不分裝置。

`awgctl` 把位址配給新的 peer 時歸零兩條規則，`usage --json` 依位址帶出 `blocked` 與 `blocked_ads`。計數跟著位址走，暫停與恢復不會歸零，容器重啟時歸零，入口網站的 worker 用跟流量相同的方式換算成增量。改了 `start.sh` 要重建映像再執行 `run.sh`，所有人會短暫斷線。只是新增規則時，可以用 `docker exec vessel-node iptables ...` 在運作中的容器照 `start.sh` 加上，再重建映像讓下次啟動也有。

入口網站的 `/dns/` 有即時檢測，讓使用者確認目前生效的過濾。四個測試網址 `vessel-dns-0` 到 `vessel-dns-3.anoni.net` 是真的網域，三個解析器用 `local-zone ... always_nxdomain` 各藏起其中幾個：

| 測試網址 | 不過濾 | 擋惡意網站 | 再擋廣告 |
|---|---|---|---|
| `vessel-dns-0` | 正常解析 | 正常解析 | 正常解析 |
| `vessel-dns-1` | 回 NXDOMAIN | 回 NXDOMAIN | 回 NXDOMAIN |
| `vessel-dns-2` | 正常解析 | 回 NXDOMAIN | 回 NXDOMAIN |
| `vessel-dns-3` | 正常解析 | 正常解析 | 回 NXDOMAIN |

三個解析器的快取至少保留 5 分鐘（`cache-min-ttl: 300`），記錄過期後先用舊的答案回應、同時在背景更新（`serve-expired`，最多再用一天）。很多網站的 TTL 只有一分鐘上下，原本快取幾乎留不住，2026-10-29 東京擋廣告的解析器命中率只有一半。代價是網站換了 IP 時，最多 5 分鐘或多一次查詢會取得舊的位址。

有過濾的兩個解析器另外對 `use-application-dns.net` 回 NXDOMAIN。這是 Firefox 的偵測網域，Firefox 每次啟動與切換網路時查詢它，查不到就關掉預設開啟的 DNS over HTTPS，查詢才會繼續經過 Vessel、讓過濾生效。不過濾的解析器不回應這個訊號，因為它的意思是「這個網路有過濾」。使用者手動指定其他安全 DNS 服務時不受影響，過濾仍然不會生效。

改了 `unbound/*.conf` 之後，複製到節點的 `/opt/vessel-node/unbound/`，再 `docker exec vessel-node pkill -HUP -x unbound` 重新載入。設定檔是掛進容器的，不必重啟容器，VPN 連線不會中斷。HUP 會讓三個解析器同時重讀名單，載入期間不回應查詢，2026-10-29 在東京實測擋廣告的解析器停了一兩分鐘，所以先寫一筆服務狀態紀錄。

`update-lists.sh` 換名單時不用 HUP，改用 `unbound-control auth_zone_reload` 只重新載入有變的那份名單，一次一個解析器。擋惡意網站與擋廣告兩個解析器各有一個只在容器內的控制 socket（`/run/unbound-<過濾>.ctl`）。載入期間那個解析器仍然不回應，但時間大約是 HUP 的一半，另外兩個照常運作。在限制 CPU 的測試裡，擋廣告的名單重新載入約 20 秒，HUP 約 40 秒以上。控制 socket 不存在時（設定更新前啟動的解析器），腳本退回 HUP。

## 容器內的防火牆

VPN 使用者只能上網：

- 轉送的預設政策是 DROP，只放行隧道到網際網路
- 使用者之間不能互連
- 連不到私有網段、`169.254.0.0/16`（雲端主機的中繼資料服務）、`100.64.0.0/10`、`127.0.0.0/8`、多播，以及節點自己的公開 IP。沒有擋的話，使用者可以經 Docker 閘道碰到主機的 SSH，繞過雲端防火牆
- 對外的 TCP 25 回 reset
- 從隧道連到容器本身只放行 53 埠
- P2P 只計數、不擋：每條連線最前面 4 個封包裡，符合 BitTorrent 特徵（沒有加密的握手、DHT 查詢、UDP 與 HTTP tracker 的請求）的封包數，記在 `VESSEL-P2P`，另外 `VESSEL-NEW` 記新連線的總數當作對照。都是整個節點的總數，不分裝置，容器重啟時歸零，用 `awgctl p2p` 讀。加密的握手看不出來，所以數字是下限
- IPv6 一律不轉送，隧道上的 IPv6 封包也不進容器。使用者只取得 IPv4 的隧道位址，AmneziaWG 本來就會丟掉其他來源的封包，這兩條是之後開了 IPv6 也不會漏的保險

## 升級

```bash
docker build -t vessel-node:latest /opt/vessel-node/build
/opt/vessel-node/run.sh    # 所有人斷線幾秒後自動接回
```

AmneziaWG 換協定世代時，舊的設定檔可能不相容，要請所有人重新建立裝置。
