# node

Vessel 的節點。每台主機執行一個容器 `vessel-node`，裡面是 AmneziaWG 3.1 與兩個 unbound 解析器，裝在主機的 `/opt/vessel-node/`。

## 檔案

| 檔案 | 放在主機的 | 用途 |
|---|---|---|
| `Dockerfile`、`start.sh` | `build/` | 最新穩定版的 Alpine（目前是 3.24）加上 unbound 與 iptables，AmneziaWG 的程式從官方 `amneziavpn/amneziawg-go` 映像的固定版本複製過來。`start.sh` 起 AWG、加 DNS 位址、設防火牆、起兩個 unbound |
| `setup.sh` | 根目錄 | 一次性安裝：建映像、產生伺服器金鑰與共用參數、下載名單、設 cron、啟動容器。已經有 `server/interface.conf` 就中止 |
| `run.sh` | 根目錄 | 重建容器 |
| `awgctl` | 根目錄，連結到 `/usr/local/sbin/awgctl` | 管理使用者 |
| `pull-lists.sh` | 根目錄 | 向維護者的主機取得名單的變動。root 的 cron 在 UTC 04:37、10:37、16:37、22:37 執行，名單由主機在 7 分鐘前產生，見 `deploy/rpz/` |
| `exclude.txt` | 維護者的主機（`deploy/rpz/`） | 不該擋的網域與理由，見「排除清單」 |
| `unbound/*.conf`、`unbound/vessel.zone` | `unbound/` | 解析器的設定：`none.conf` 不過濾，`filter.conf` 同時服務兩種過濾。`vessel.zone` 讓廣告名單的 CNAME 目標在本機回 NXDOMAIN，見「擋下次數」 |
| `node.env.example` | 複製成 `node.env` | 節點的公開 IP 與 AWG 的埠，不進 repo |
| `host/vessel-inspect.conf` | `/etc/modules-load.d/` | 裝置檢測需要的核心模組，見「裝置檢測」 |
| `host/99-vessel-node.conf` | `/etc/sysctl.d/` | 主機的核心參數，見「主機的調校」 |
| `host/vessel-net-tune.sh`、`host/vessel-net-tune.service` | `host/`，服務放 `/etc/systemd/system/` | 開機時調整對外網卡的佇列與 UDP 轉送，見「主機的調校」 |
| `host/cve-2026-98432-ipopt`、`host/cve-2026-98432-ipopt.service` | 腳本放 `/usr/local/sbin/`，服務放 `/etc/systemd/system/` | 核心修正之前丟棄帶 IPv4 選項的 TCP SYN，見「安裝」 |
| `host/vessel-probe-watch.sh`、`host/vessel-probe-watch.service`、`host/vessel-probe-watch.timer` | 腳本放 `host/`，服務與計時器放 `/etc/systemd/system/` | 統計打到 AWG 埠、不是使用者的封包，見「探測與掃描的觀察」 |
| `reach-sites.tsv`、`host/vessel-reach.py`、`host/vessel-reach.service`、`host/vessel-reach.timer` | 清單放根目錄，腳本放 `host/`，服務與計時器放 `/etc/systemd/system/` | 每小時檢查這個節點打不打得開常用的網站，見「節點打不開的網站」 |

主機上另外有 `server/`（伺服器私鑰與 `HeaderProtectionKey`）、`peers/`、`clients/`、`conf/awg0.conf` 與 `rpz/`，都不進 repo。

## 安裝

需要 Docker 與 Python 3。雲端防火牆只開 AWG 的 UDP 埠，SSH 限定來源。主機的 ufw 設定同樣的規則，雲端防火牆在主控台誤改或換主機時還有一層：預設擋下所有連入，SSH 只接受跳板主機與 Tailscale，AWG 的 UDP 埠全開，Beszel 的 45876 只開給 Tailscale。ufw 的紀錄要關掉（`sudo ufw logging off`）：被擋下的封包裡，大多是使用者經過節點連到網站之後、網站在連線結束後才送回的回程封包，紀錄會留下網站的 IP 與時間，等於把連線的目的地與時間寫進硬碟。

核心修正 CVE-2026-98432 之前，主機另外用一個 systemd 服務在 `raw` 表丟棄帶 IPv4 選項的 TCP SYN（跟容器內的規則相同，見「容器內的防火牆」）。換上修正的核心之後，停用並刪除這個服務。

```bash
install -m 755 host/cve-2026-98432-ipopt /usr/local/sbin/
install -m 644 host/cve-2026-98432-ipopt.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cve-2026-98432-ipopt.service
```

```bash
mkdir -p /opt/vessel-node/build /opt/vessel-node/unbound
# 把 Dockerfile、start.sh 放進 build/，unbound/*.conf 與 unbound/vessel.zone 放進 unbound/，其他檔案放在根目錄
cp node.env.example /opt/vessel-node/node.env   # 填上 NODE_IP 與 LISTEN_PORT
bash /opt/vessel-node/setup.sh
```

接著套用主機的調校（見下一節）。

## 主機的調校

雲端映像的預設值是給一般主機用的，VPN 節點要轉送很多人的流量，調整三件事。都可以在線上直接套用，不必重啟容器，使用者不會斷線：

- 對外網卡的佇列改成 `fq_codel`：雲端映像留著 `pfifo_fast`，所有封包排同一個隊。有人大量下載時，其他人的網頁與 DNS 封包會排在後面。`fq_codel` 每條連線各自排隊，短小的封包先過
- 開啟網卡的 `rx-udp-gro-forwarding`：VPN 的 UDP 封包經 Docker 轉送，合併之後每個封包的 CPU 負擔比較低
- `vm.swappiness` 調到 10：解析器的名單佔約 1 GB 記憶體，換到 swap 的話，查詢會突然變慢

容器設了記憶體 1,600 MB 與 256 個行程的上限（`run.sh`），加入 DNSBunker CTI 之前，解析器載入名單時的高峰約 1.25 GB，CTI 只留託管平台的部分之後約佔 190 MB。裡面失控時不會連累容器外的 SSH、Tailscale 與 Beszel。現有的容器不必重建，用 `docker update --memory 1600m --memory-swap 1600m --pids-limit 256 vessel-node` 直接套用，不會斷線。

UDP 的 socket 緩衝不用調，`amneziawg-go` 有 `NET_ADMIN`，會自己強制取得它要的大小。

```bash
install -m 644 host/99-vessel-node.conf /etc/sysctl.d/99-vessel-node.conf && sysctl --system
install -m 644 host/vessel-net-tune.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vessel-net-tune.service
```

主機商對頻寬有約定上限的節點，在 `node.env` 設 `UPLINK_RATE`（例如 `24mbit`），`vessel-net-tune.sh` 改用 `cake` 把對外網卡限制在這個速率，同樣每條連線各自排隊。節點轉送的流量都會從對外網卡出去一次，所以上傳與下載都受限。改了之後執行 `systemctl restart vessel-net-tune.service`，使用者不會斷線。

確認：`tc qdisc show dev <網卡>` 的第一行是 `fq_codel`（有設 `UPLINK_RATE` 的節點是 `cake`），`ethtool -k <網卡> | grep rx-udp-gro-forwarding` 是 `on`，`sysctl vm.swappiness` 是 10。

## 管理使用者

```bash
awgctl list [--json]                          # 名稱、過濾選項、隧道 IP、最後握手、流量
awgctl add <名稱> [none|malware|ads]          # 由節點產生金鑰，設定檔寫在 clients/
awgctl add-pubkey <ID> <公鑰> <PSK> [過濾]     # 入口網站用，金鑰在瀏覽器產生
awgctl usage --json                           # 流量計數與介面啟動的時間
awgctl suspend <名稱>                         # 額度用完：peer 下線，金鑰留在節點
awgctl resume <名稱>                          # 恢復暫停的 peer
awgctl throttle on <名稱>                     # 額度用完：限速到上傳、下載各約 2 Mbit/s，仍然連得上
awgctl throttle off <名稱>                    # 恢復全速
awgctl show <名稱>
awgctl remove <名稱>
awgctl inspect on <名稱> <結束時間的 epoch 秒數>  # 開始檢測，最長 8 天
awgctl inspect off <名稱>                     # 立刻停止
awgctl inspect status --json                  # 檢測中的裝置
```

增刪使用者用 `awg syncconf` 套到執行中的介面，不會中斷其他人。會改變設定的指令一次只執行一個（`flock`），入口網站與 worker 同時呼叫時不會配出重複的位址。隧道位址從 `.2` 配到 `.249`，`.250` 到 `.254` 保留給節點自己。位址回收給下一台裝置之前，先清掉核心裡這個位址的連線追蹤（`conntrack`），已建立的 TCP 連線預設保留 5 天，不清的話前一台裝置的回應封包會送到新的裝置。2026-11 之前建置的映像沒有 `conntrack`，會略過這一步，重建映像並執行 `run.sh` 之後生效。每個使用者另外有一個私有的 IPv6 位址（ULA，`fd60:f74e:973c::/64`），結尾的數字跟 IPv4 位址相同，用途見下方防火牆的 IPv6 那一條。

`add-pubkey` 回傳 JSON，內容是設定檔除了私鑰以外的全部欄位（`interface` 與 `peer` 兩組），入口網站在瀏覽器裡補上私鑰組成設定檔。節點上不會留下這個使用者的設定檔。`Jc`、`Jmin`、`Jmax` 與 `I1` 只在客戶端作用，每個使用者各自隨機產生。`I1` 偽裝成 QUIC v1 的 Initial 封包，與節點使用的 UDP 443 一致。開頭幾個位元組符合 QUIC 的格式，DCID 與後面的內容每次握手重新隨機產生，封包大小在 1200 到 1252 位元組之間，依使用者固定。已經建立的設定檔維持原本的 `I1`，重新建立裝置才會換成新的。

`usage --json` 的計數在容器重啟時歸零，`interface_started` 讓呼叫端判斷要不要重新累計。

`suspend` 把 peer 的設定搬到 `suspended/`，`resume` 再搬回來。入口網站把 PresharedKey 交給節點之後就不保存，所以暫停與恢復都在節點上完成。兩個指令重複執行都不會出錯，`remove` 也會清掉暫停中的 peer。`remove`、`suspend`、`resume` 不論 peer 原本在哪裡，都會再套用一次設定，前一次搬了檔案卻套用失敗時，入口網站重試就會補上。`node/test/awgctl-test.sh` 用假的 docker 測試這幾件事。

`throttle on` 在容器的 `VESSEL-THROTTLE`（`FORWARD` 的第一條規則跳過去，第一次用到時建立）替隧道位址加兩條 `hashlimit` 規則，上傳、下載各限 256 KB/s，超過的封包丟掉，TCP 與 QUIC 會自己降速。本機用真的 iptables 與 iperf3 量過，限速後上傳、下載各約 2.75 Mbit/s，UDP 約 2.2 Mbit/s。規則不寫進檔案，容器重啟就沒了，`usage --json` 依位址帶出 `throttled`，入口網站的 worker 每 5 分鐘比對並補回。位址換給下一台裝置之前，`add-pubkey` 與 `remove` 都會清掉它的限速。暫停中的 peer 也能限速，恢復時直接是慢的。

## 入口網站的金鑰

入口網站經 tailnet 用 SSH 呼叫節點，那把金鑰在節點上綁定 `awgctl-remote`，只能執行 `add-pubkey`、`remove`、`suspend`、`resume`、`throttle on`、`throttle off`、`list --json`、`usage --json`，以及讀取「節點打不開的網站」結果的 `reach --json`，參數數量不對、要開 shell 或執行其他指令都會被拒絕。把 `awgctl-remote` 放到 `/usr/local/sbin/`，root 的 `authorized_keys` 加上：

```
command="/usr/local/sbin/awgctl-remote",restrict,from="<入口網站主機的 tailnet IP>" ssh-ed25519 AAAA... vessel-portal
```

## DNS 與過濾

節點的解析器依使用者建立裝置時選的過濾回應，只處理查詢，不記錄查詢。名單的目標是擋下安全威脅，廣告與追蹤由使用者自己選擇，不做內容管制，規避審查的工具與動態 DNS 不擋。名單裡出現不該擋的網域時，列進排除清單。組合的原則還在定稿。

名單從上游到解析器經過下面幾步：

1. 下載：維護者的主機（`deploy/rpz/build-zones.sh`）每 6 小時（UTC 04:30、10:30、16:30、22:30）下載六份名單，節點不連到上游，上游看到的是維護者主機的 IP。只接受 HTTPS（轉址也是），單一檔案上限 64 MB，同一時間只有一個執行中
2. 轉換：165 的 CSV、數位產業署的 JSON 與 Echap 的網域清單轉成 RPZ，HaGeZi 的名單本身就是 RPZ。每份名單最後都只剩「擋下」的條目（`名稱 CNAME .` 與它的萬用字元）。RPZ 還能回應自訂的位址、放行某個名稱，或依查詢裝置的位址觸發（`rpz-client-ip`），上游的名單被竄改時可以拿來把使用者導到別的網站，或只針對某一台裝置，所以這些條目與 `$INCLUDE` 一律丟掉並計數。轉換的名單另外不收多個網站共用的名稱（`com.tw`、`github.io` 這類），資料集裡一筆錯誤不會擋掉底下所有網站
3. 排除：每份名單都拿掉 `exclude.txt` 列的名稱，見「排除清單」
4. 檢查：下載失敗、內容太短，或 CTI 超過 45 萬個網域時保留上一份，網域沒有變動就不更新。`rpz-zones.conf` 另外替擋惡意網站的五份名單設定 `rpz-action-override: nxdomain`，即使有別的條目通過上一步，回應也只會是 NXDOMAIN。`deploy/rpz/test/` 測試這一步與上一步
5. 去重複：後面的名單拿掉前面已經擋下的條目（`deploy/rpz/dedupe.py`）。unbound 依序比對，第一筆符合就結束，後面重複的條目用不到，拿掉不改變任何回應與計數。2026-11-09 用實際名單比對 4,830 筆，兩個解析位址都沒有差異，條目少 8%（幾乎都在廣告名單），記憶體從 1,108 MB 降到 1,017 MB。任何一份會少掉超過六成時保留上一份並告警
6. 載入：節點的 unbound 透過 Tailscale 只取得變動的部分（IXFR），依查詢進來的位址套用，見「一個 unbound 服務兩種過濾」

入口網站的網域過濾頁（`/dns/`）可以查一個網域在不在名單上。後端（`api/app/blocklists.py`）另外下載同樣的名單放在記憶體裡，每 8 小時更新，排除的網域相同，查詢不經過節點。

| 位址 | 選項 | 名單 |
|---|---|---|
| `10.8.1.1` | 不過濾 | 無 |
| `10.8.1.253` | 擋惡意網站 | [HaGeZi](https://github.com/hagezi/dns-blocklists) Threat Intelligence Feeds（mini），加上 165 與數位產業署停止解析的詐騙網站、Echap 收集的跟蹤軟體網域與 DNSBunker CTI 裡託管平台的部分，其他查詢轉給 Quad9 |
| `10.8.1.254` | 再擋廣告 | 上面五份，加上 HaGeZi Multi PRO，其他查詢轉給 Quad9 |

兩個 unbound 都不記錄查詢，開 DNSSEC 驗證，只接受隧道內的查詢。不過濾的 unbound 自行遞迴查詢，開 QNAME 最小化。名單載入後約佔 0.7 GB 記憶體（DNSBunker CTI 約 190 MB，依每個網域 1.3 KB 估算），節點至少要 2 GB，並準備 1 GB 以上的 swap，重新載入名單時用量會短暫升高。

### 一個 unbound 服務兩種過濾

`.253` 與 `.254` 由同一個 unbound（`filter.conf`）回應，依查詢進來的位址套用不同的名單，惡意網站與 165 的名單只載入一次（toomore/anoni-net-ws#447）。2026-11-01 以前是兩個 unbound，各載入一份，合併之後記憶體從 338 ＋ 608 MB 降到約 606 MB。

- `interface-tag` 把 `.253` 標成 `malware`、`.254` 標成 `ads`。RPZ 用 `tags:` 限定套用的位址，惡意網站與 165 標 `malware ads`，廣告標 `ads`。測試網址與 Firefox 的偵測網域用 `local-zone-tag`
- 不能寫 `access-control`：unbound 先用來源 IP 比對 `access-control`，比對到就不看介面的設定，標記會失效。所以兩個位址都用 `interface-action: allow`，只有隧道連得到這兩個位址
- 需要 unbound 1.21 以上。1.20.0 經過遞迴的查詢不檢查標記，不過濾的查詢也會被擋（NLnetLabs/unbound#1079），這也是映像改用最新穩定版 Alpine 的原因
- 不過濾的 `.1` 維持獨立的 unbound，只佔約 10 MB。名單更新時有過濾的 unbound 會暫停，獨立出來就不影響選了不過濾的使用者

擋廣告的名單原本用 Multi（Normal），2026-10-31 改成 HaGeZi 建議的 PRO。比對一個家用網路 Pi-hole 近 7 天擋下最多的 300 個網域，Normal 涵蓋其中 16.5% 的擋下次數，PRO 涵蓋 30.3%。Pi-hole 擋下而 PRO 沒有擋的，多半是定位、iCloud、憑證、視訊通話的 STUN 這類擋了會壞掉功能的服務，不適合放在大家共用的服務上。

### 轉發給 Quad9

台北節點連到的 Quad9 在新加坡，所以台北節點的 `filter.conf` 把 `forward-addr` 改成 Cloudflare 的 `1.1.1.2@853#security.cloudflare-dns.com` 與 `1.0.0.2@853#security.cloudflare-dns.com`，更新 `filter.conf` 時要保留這兩行。

有過濾的 unbound 比對完名單之後，把其他查詢經 DNS over TLS 轉給 Quad9（`9.9.9.9`）。Quad9 判斷有害的網域回 NXDOMAIN，補上名單涵蓋不到的釣魚網站。不過濾的 unbound 不轉發。

- Quad9 看得到節點的 IP 與查詢的網域，看不到裝置的 IP。TLS 讓節點的主機商與上游業者看不到查詢的內容
- 這個 unbound 仍做 DNSSEC 驗證。Quad9 擋下未簽章的網域時回 NXDOMAIN，擋下有簽章的網域時驗證失敗，回 SERVFAIL，兩者都打不開。拿掉驗證的話，`forward-first` 會把 Quad9 對驗證失敗的網域回的 SERVFAIL 當成故障，改由自己查詢，反而放行偽造的回應
- Quad9 無法連線時（`forward-first`），前面 1 到 2 分鐘的新查詢會逾時，之後改由 unbound 自行遞迴查詢，名單與 DNSSEC 驗證仍然有效
- `tls-cert-bundle` 只在 unbound 啟動時讀取，第一次加上轉發時要重啟有過濾的 unbound，`pkill -HUP` 不會生效，查詢會退回自行遞迴：`docker exec vessel-node sh -c 'kill "$(cat /run/unbound-filter.pid)"; sleep 2; unbound -c /etc/unbound/conf.d/filter.conf'`
- 裝置清單的擋下次數只算名單擋下的，Quad9 的 NXDOMAIN 看起來跟一般的網域不存在相同，無法分開計數
- Quad9 誤擋時，在 `filter.conf` 替該名稱加一個 `forward-zone`，轉給不過濾的 `9.9.9.10@853#dns10.quad9.net`，並列進名單頁的排除的網域
- 入口網站的查詢（`api/app/blocklists.py`）同時問 `9.9.9.9` 與 `9.9.9.10`，只有前者回 NXDOMAIN 時，判定為 Quad9 擋下

### 165 停止解析的涉詐網站

台灣的電信業者依《詐欺犯罪危害防制條例》第 42 條，對刑事警察局列管的涉詐網站停止解析，HiNet 的 DNS 對這些網域回封鎖頁的 IP。連上 Vessel 之後查詢改走節點的解析器，少了這層保護，而 HaGeZi 的名單幾乎沒有收這些網域（2026-10-31 比對 8.6 萬個網域，完整的 TIF 只涵蓋 0.2%）。所以兩個有過濾的解析器另外載入這份名單（toomore/anoni-net-ws#446）。

- 來源是警政署在政府資料開放平台公布的[165反詐騙諮詢專線_遭停止解析涉詐網站](https://data.gov.tw/dataset/176455)，政府資料開放授權條款第 1 版，CSV 格式，不定期更新，資料約落後一個月
- 維護者的主機（`deploy/rpz/lists.sh`）下載 CSV，取出網域，清掉前面的協定與雜字，格式不對的捨棄，產生 `tw165` 這份名單。每個網域連同子網域回 NXDOMAIN，上層網域也在名單上的網域就不再列出，2026-10-31 的 8.6 萬個網域因此剩 6.5 萬個。清單裡沒有短網址、免費架站平台這類共用的上層網域，只有它們底下的子網域，擋子網域不會波及其他網站
- 開 `rpz-signal-nxdomain-ra`，擋下的次數算進詐騙與惡意網站
- 兩個解析器各多約 80 MB 記憶體（2026-10-31 在 unbound 1.25 實測，去掉重複之前是 110 MB）
- 名單只照資料集的內容，資料集刪掉的網域，下次更新時就不再擋

### 數位產業署停止解析的詐騙購物網站

數位發展部數位產業署是 TWNIC DNS RPZ 的可信任通報機構，受理電商通報的一頁式詐騙購物網站，多半冒用台灣的電商與金流業者。清單公布在政府資料開放平台的[數位產業署聲請詐騙網域名稱停止解析網址清單](https://data.gov.tw/dataset/165027)，JSON 格式，2026-11-01 有 1,734 筆，從 2023 年 6 月到 2026 年 10 月。165 的名單只涵蓋其中 11%，HaGeZi 的 TIF 約 1%，沒被涵蓋的網域約 15% 還能解析（toomore/anoni-net-ws#448）。

- 維護者的主機跟 165 的名單用同一段程式轉成 `twmoda` 這份名單，清理、去重複的方式相同，擋網域與子網域
- 「網域名稱」欄有打錯字的情況，例如詐騙網址是 `laobeibi.shop`，網域欄寫 `aobeibi.shop`。網域欄跟「偽冒網址」的主機一致，或是那個主機的上層網域時才用網域欄，兩者都合法卻不一致時只用網址的主機，避免擋到打錯字的無關網域（2026-11-01 有 3 筆）
- 伺服器擋下 Python 預設的 User-Agent，入口網站下載時要帶自己的 User-Agent，`curl` 不受影響
- 開 `rpz-signal-nxdomain-ra`，算進詐騙與惡意網站，記憶體約 2 MB

### 跟蹤軟體

跟蹤軟體（stalkerware）裝在別人的手機上，把位置、訊息與通話送到裝的人那裡，常見於親密關係暴力。法國的 Echap 協會整理這類 App 連線的網域，公布在 [stalkerware-indicators](https://github.com/AssoEchap/stalkerware-indicators)，授權是 CC BY 4.0，使用時要標明出處。

- 維護者的主機下載 `generated/hosts`，跟 165 的名單用同一段程式轉成 `stalkerware` 這份名單，擋網域與子網域。2026-11-08 有 929 個網域，去掉上層網域已經涵蓋的之後剩 639 個
- Firebase、S3、CloudFront 上的名稱各自屬於一個 App，擋了不影響同一個平台上的其他服務。Azure App Service 的兩個共用前端（`waws-prod-blu-247`）是其他網站也會指向的名稱，列進排除清單
- Quad9 也採用 Echap 的名單。2026-11-08 比對還能解析的 520 個網域，Quad9 擋下 484 個，沒擋的 35 個多半是這些 App 的官網，節點的名單補上這些
- Quad9 擋下的不會算進裝置的擋下次數，節點自己的名單開 `rpz-signal-nxdomain-ra`，算進詐騙與惡意網站。之後要提醒使用者裝置可能被裝了跟蹤軟體時，需要這份計數
- 記憶體約多 0.8 MB（2026-11-08 用 Alpine 3.24 的 unbound 實測）

### DNSBunker CTI

[DNSBunker/CTI](https://github.com/DNSBunker/CTI) 公開確認活躍的惡意網域，包括釣魚、惡意程式散布、詐騙與假店，託管平台只收個別主機名，授權是 GPL-2.0-only。Vessel 原有的名單對託管平台上的釣魚網站涵蓋不足，DNSBunker CTI 收錄了其中許多個別主機名。

- 只使用託管平台上的子網域，也就是 Public Suffix List 私有區段底下的名稱。2026-11-09 整份約 41.5 萬個網域，這部分約 15 萬個。維護者預期整份會增長到 120 萬個網域（[DNSBunker/CTI#3](https://github.com/DNSBunker/CTI/issues/3)），節點放不下，託管平台又是其他名單最弱的地方。私有區段由主機每次產生名單時下載，下載失敗時沿用上一份
- 維護者的主機（`deploy/rpz/`）下載 `domains.txt`，跟 165 的名單用同一段程式清理，產生區域檔，由 NSD 提供。節點的 unbound 跟其他名單一樣透過 Tailscale 訂閱（`unbound/rpz-zones.conf`，從 `rpz-zones.conf.example` 產生，主伺服器的位址放在 `node.env` 的 `RPZ_PRIMARY`）。兩個過濾選項都載入，開 `rpz-signal-nxdomain-ra`，算進詐騙與惡意網站
- 主機在 UTC 04:30、10:30、16:30、22:30 產生名單，節點 7 分鐘後用 `auth_zone_transfer` 取得變動的部分（IXFR）。上游建議每 1 到 6 小時取用，這份名單一小時變動約一千筆。2026-11-08 在東京節點實測，3,336 個網域的變動讓有過濾的解析器暫停約 1.5 秒，查詢沒有失敗，整份重新載入要 12 秒。NOTIFY 被 unbound 拒絕，所以由節點主動取得
- 主機無法連線時，節點繼續用手上的名單，unbound 把名單存在 `/var/lib/unbound-rpz`，重啟不必重新傳送
- 2026-11-08 用 Alpine 3.24 的 unbound 實測，38 萬個網域約多 485 MB 記憶體，更新時峰值沒有升高。筆數上限是 45 萬個網域，超過就保留上一份，低於 5 萬個網域也一樣
- 第一次加入時不能用 HUP，HUP 會讓所有名單重新載入，記憶體高峰可能超過容器的上限。把 `filter.conf`、`rpz-zones.conf` 複製到節點，再用「轉發給 Quad9」一節的指令只重啟有過濾的 unbound
- 涵蓋率的量測與上游的確認，記錄在維護者的內部研究

### 排除清單

少數不該擋的網域列在 `exclude.txt`，每一行寫明理由，維護者的主機產生每份名單時都會拿掉。公開的清單讓任何人都可以檢查這些決定。

- 只排除那個名稱本身。底下的名稱仍然留在名單上，上層網域在名單上時仍然會擋到它
- 改了之後複製到維護者主機的 `/srv/vessel-rpz/exclude.txt`，下一次產生名單就會生效，節點接著取得變動的部分，不必重建映像或重啟容器
- 入口網站的查詢讀 `api/app/blocklist_exclude.txt`，內容要相同，後端的測試會比對

### 擋下次數

裝置頁顯示每台裝置本月有幾次查詢被名單擋下，擋惡意網站的裝置只算惡意網站的名單，擋廣告的裝置兩份名單都算。節點只計數，不記錄網域。2026-10-31 以前廣告名單擋下的不算，使用者開了最高的過濾卻只看到個位數，以為過濾沒在運作。

兩份名單分開計數，每月的防護成績單（toomore/anoni-net-ws#445）要分別列出「詐騙與惡意網站」與「廣告與追蹤」：

- 惡意網站的名單開了 `rpz-signal-nxdomain-ra`，擋下的回應是清掉 RA 旗標的 NXDOMAIN，一般的回應不會這樣。`start.sh` 的 `VESSEL-BLOCKED` 用 `u32` 比對 DNS 標頭
- 廣告的名單用 `rpz-action-override: cname`，擋下的回應是指向 `blocked.vessel.` 的 CNAME，這個名稱由 `filter.conf` 的 `auth-zone`（區域檔 `vessel.zone`）回 NXDOMAIN，不會往外查。2026-11-10 以前用 `local-zone`，它只回應裝置直接查詢的名稱，unbound 跟著 CNAME 解析時不會用到，每次快取過期就把 `blocked.vessel.` 送給 Quad9 查詢一次（#242）。`auth-zone` 在跟著 CNAME 解析時也會用到。`vessel.` 沒有簽章，`filter.conf` 另外設 `domain-insecure: "vessel."`，否則 DNSSEC 驗證會向根伺服器查 `vessel.` 的 DS，回應變成 SERVFAIL。`VESSEL-ADS` 從第 41 個位元組開始比對：有些裝置收到 CNAME 之後會再查一次 `blocked.vessel.` 本身，這時名稱在問題區段的開頭（第 40 個位元組），從第 41 個位元組開始比對就不會把同一次擋下算兩次。2026-10-31 的東京節點上，這類回應佔了 `VESSEL-ADS` 的三分之二。`VESSEL-ADS` 用 `string` 比對回應裡的這個名稱

兩條 chain 都是每個隧道位址（`.2` 到 `.249`）一條規則，只累計封包數。兩份名單都有的網域，`.254` 先比對惡意網站的名單，只算在惡意網站那邊。

兩個解析器開了 `extended-statistics`，`unbound-control -c /etc/unbound/conf.d/filter.conf stats_noreset` 的 `num.rpz.action.*` 是兩種過濾合計擋下的次數，`rpz-nxdomain` 是惡意網站與 165，`rpz-cname-override` 是廣告，用來比較換名單前後的差別，沒有網域也不分裝置。

`awgctl` 把位址配給新的 peer 時歸零兩條規則，`usage --json` 依位址帶出 `blocked` 與 `blocked_ads`。計數跟著位址走，暫停與恢復不會歸零，容器重啟時歸零，入口網站的 worker 用跟流量相同的方式換算成增量。改了 `start.sh` 要重建映像再執行 `run.sh`，所有人會短暫斷線。只是新增規則時，可以用 `docker exec vessel-node iptables ...` 在運作中的容器照 `start.sh` 加上，再重建映像讓下次啟動也有。

入口網站的 `/dns/` 有即時檢測，讓使用者確認目前生效的過濾。四個測試網址 `vessel-dns-0` 到 `vessel-dns-3.anoni.net` 是真的網域，解析器用 `local-zone ... always_nxdomain` 依位址藏起其中幾個：

| 測試網址 | 不過濾 | 擋惡意網站 | 再擋廣告 |
|---|---|---|---|
| `vessel-dns-0` | 正常解析 | 正常解析 | 正常解析 |
| `vessel-dns-1` | 回 NXDOMAIN | 回 NXDOMAIN | 回 NXDOMAIN |
| `vessel-dns-2` | 正常解析 | 回 NXDOMAIN | 回 NXDOMAIN |
| `vessel-dns-3` | 正常解析 | 正常解析 | 回 NXDOMAIN |

兩個解析器的快取至少保留 5 分鐘（`cache-min-ttl: 300`），記錄過期後先用舊的答案回應、同時在背景更新（`serve-expired`，最多再用一天）。很多網站的 TTL 只有一分鐘上下，原本快取幾乎留不住，2026-10-29 東京擋廣告的解析器命中率只有一半。代價是網站換了 IP 時，最多 5 分鐘或多一次查詢會取得舊的位址。

有過濾的兩個位址另外對 `use-application-dns.net` 回 NXDOMAIN。這是 Firefox 的偵測網域，Firefox 每次啟動與切換網路時查詢它，查不到就關掉預設開啟的 DNS over HTTPS，查詢才會繼續經過 Vessel、讓過濾生效。不過濾的解析器不回應這個訊號，因為它的意思是「這個網路有過濾」。使用者手動指定其他安全 DNS 服務時不受影響，過濾仍然不會生效。

改了 `unbound/*.conf` 之後，複製到節點的 `/opt/vessel-node/unbound/`，先用 `docker exec vessel-node unbound-checkconf /etc/unbound/conf.d/filter.conf` 檢查，再 `docker exec vessel-node pkill -HUP -x unbound` 重新載入。`filter.conf` 引用的 `vessel.zone` 要一起複製。少了 `vessel.zone`，unbound 在 HUP 時會結束，`.253` 與 `.254` 都停止回應，`unbound-checkconf` 可以事先發現。設定檔是掛進容器的，不必重啟容器，VPN 連線不會中斷。HUP 會讓兩個解析器同時重讀名單，載入期間不回應查詢，2026-10-29 在東京實測擋廣告的解析器停了一兩分鐘，所以先寫一筆服務狀態紀錄。

名單更新時不用 HUP。`pull-lists.sh` 先比對序號，主機比較新的名單才用 `unbound-control auth_zone_transfer` 取得變動的部分，這個指令會略過序號檢查，沒有變動的名單也照樣傳送，六份一起約中斷 10 秒。有過濾的解析器有一個只在容器內的控制 socket（`/run/unbound-filter.ctl`）。傳送期間 `.253` 與 `.254` 會暫停一下，2026-11-09 在東京實測，廣告名單增減 2,500 個網域約 0.5 秒，CTI 的一般變動約 1.8 秒，不過濾的 `.1` 照常運作。主機無法連線時，節點繼續用手上的名單，unbound 把收到的名單存在 `/var/lib/unbound-rpz`，重啟不必重新傳送。

## 容器內的防火牆

VPN 使用者只能上網：

- 轉送的預設政策是 DROP，只放行隧道到網際網路
- 使用者之間不能互連
- 連不到私有網段、`169.254.0.0/16`（雲端主機的中繼資料服務）、`100.64.0.0/10`、`127.0.0.0/8`、多播，以及節點自己的公開 IP。沒有擋的話，使用者可以經 Docker 閘道碰到主機的 SSH，繞過雲端防火牆
- 對外的 TCP 25 回 reset
- 每台裝置最多同時 2,000 條連線（`start.sh` 的 `DEVICE_FLOWS`），超過時新的連線立刻被拒絕，已經建立的不受影響。一台裝置失控或被控制時，塞不滿所有裝置共用的連線追蹤表。2026-11-07 到 11-08 在三台節點量測 24 小時，沒有裝置超過 500 條，曾超過 200 條的只有新加坡的兩分鐘。只累計整個節點被拒絕的次數，用 `awgctl p2p` 讀，不分裝置
- 從隧道連到容器本身只放行 53 埠，以及 `10.8.1.1` 的 TCP 443（檢測的確認頁，見下方「確認頁」）。443 只對確認頁監聽的位址開放，之後在 `.253`、`.254` 等其他位址開了 443 的服務也不會被放行
- 帶 IPv4 選項（Record Route、Timestamp）的 TCP SYN 一律丟棄。這類 SYN 能觸發核心處理 TCP 握手時的釋放後使用漏洞（CVE-2026-98432），使用者連得到解析器的 TCP 53 埠，而正常的連線不會帶這些選項。所有節點換上修正的核心之後就可以拿掉
- P2P 只計數、不擋：每條連線最前面 4 個封包裡，符合 BitTorrent 特徵（沒有加密的握手、DHT 查詢、UDP 與 HTTP tracker 的請求）的封包數，記在 `VESSEL-P2P`，另外 `VESSEL-NEW` 記新連線的總數當作對照。都是整個節點的總數，不分裝置，容器重啟時歸零，用 `awgctl p2p` 讀。`awgctl usage --json` 的 `totals` 也帶著這些計數，入口的 worker 每 5 分鐘讀用量時一起存下，計數大於 0 時 `deploy/health_warn.py` 推播。加密的握手看不出來，所以數字是下限
- IPv6 一律拒絕：從隧道進來的 IPv6 不轉送、也不進容器，回 ICMPv6 的拒絕讓 App 立刻改用 IPv4。節點沒有 IPv6 的對外連線，但每個使用者仍然要有一個 ULA 位址。設定檔只有 IPv4 位址時，iOS 即使在 `AllowedIPs` 寫了 `::/0` 也不會把 IPv6 送進隧道，有 IPv6 的網站會繞過 VPN 直接連線（2026-11-03 在 iPhone 上用連線檢測發現）。有了 ULA，作業系統連網際網路上的位址時會優先選 IPv4（RFC 6724），IPv6 被送進隧道後拒絕，不會外洩。要拒絕而不是丟棄，轉送的封包才會經過 `FORWARD`，所以 `run.sh` 開了 `net.ipv6.conf.all.forwarding`，`FORWARD` 的預設政策仍然是 DROP

## 裝置檢測

開啟檢測的裝置，封包會複製到 NFLOG 群組 42，規劃見 toomore/anoni-net-ws#480。沒有開啟的裝置沒有任何規則，封包不會被複製。

每條連線前 12 個封包完整複製，TLS 與 QUIC 的 hello 要完整才讀得到伺服器名稱，之後每個封包只取前 128 位元組，內容不會離開節點。實測下，傳出去的資料量比完整封包少了 91% 到 97%，封包表頭算出的流量跟完整封包相同。

規則寫在 `mangle` 表的 `PREROUTING` 與 `POSTROUTING`，以通道位址比對。幾個會影響隱私的地方：

- 每條規則帶著自己的結束時間（`-m time --datestop`），入口網站連不上節點時也會停止
- `remove` 刪除裝置前先清掉規則，`add` 與 `add-pubkey` 配發位址時再清一次。通道位址會重複使用，沒有清掉的話，下一個拿到這個位址的裝置會被複製
- 清除失敗時 `remove` 與新增都會中止，不會留下規則繼續執行
- 容器重建時規則會消失，檢測會停止，不會自動恢復

`host/vessel-inspect.conf` 放到 `/etc/modules-load.d/`，開機時載入 `xt_time` 與 `nfnetlink_log`，容器沒有權限自己載入模組。

### 確認頁

開啟檢測時要在該裝置上打開確認連結，只知道帳號號碼的人無法遠端開啟。`host/vessel-inspect-confirm.py` 只聽通道內的 `10.8.1.1:443`，節點用連線的通道位址判斷是哪台裝置，WireGuard 不允許 peer 用別人的位址傳送。入口網站用 `awgctl inspect confirms --json` 讀取，用完 `inspect ack` 刪除，超過 1 小時的自動刪除。

網域 `confirm.vessel.anoni.net` 由節點的解析器解析到 `10.8.1.1`，憑證放在 `/opt/vessel-node/confirm/`（`fullchain.pem`、`privkey.pem`），沒有憑證時服務不會啟動。

## 探測與掃描的觀察

偽裝的連線被認出來之前，常見的跡象是有人模仿或重送使用者的握手，打到節點的 AWG 埠，看伺服器會不會回應。AmneziaWG 對驗證不過的封包一律不回應，這些封包本身不會造成問題，但數量的變化可以提早透露節點被注意到了。

`vessel-probe-watch` 每分鐘把各 peer 目前的端點放進主機上 nftables 的一個集合（`inet vessel_probe`），打到 AWG 埠、來源不在集合裡的封包就計數，來源另外記在一個一小時後過期的集合，只為了計算來源數與來源的大區。每個整點把數字寫進 `/var/lib/vessel-probe/hourly.csv`，然後歸零。檔案裡只有時間、封包數、來源數，以及各大區的來源數（台灣、港澳、中國、日韓、東南亞、其他亞太、亞太以外），來源的 IP 只在核心的記憶體裡，不印出，也不寫入硬碟。大區依 APNIC 公開的配發清單比對 IP 的登記地，清單每週下載一次，存在同一個目錄，下載失敗時沿用舊的，從未下載成功時大區留白。整點當下是某台裝置端點的位址不算進大區，所以大區加起來可能少於來源數。規則只計數、不擋，掛在 Docker 轉址之前，不影響使用者的連線。

```bash
install -m 755 host/vessel-probe-watch.sh /opt/vessel-node/host/
install -m 644 host/vessel-probe-watch.service host/vessel-probe-watch.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vessel-probe-watch.timer
/opt/vessel-node/host/vessel-probe-watch.sh show    # 最近 48 小時
```

同一份裝置清單也保護這個埠。Docker 用 DNAT 轉送，每個來源都佔一筆連線追蹤，偽造來源的封包可能塞滿追蹤表，讓所有人的新連線失敗。追蹤開始之前，現有裝置的端點直接放行，其他來源共用每秒 2,000 個封包的額度，超過就丟棄並計數，寫進 `hourly.csv` 的 `dropped`。依 UDP 沒有回應時 30 秒的逾時計算，放行的量最多約佔 6 萬筆，低於調高後 26 萬筆的上限（`nf_conntrack_max`，每筆約 320 位元組，用到才佔記憶體）。清單每分鐘更新，換了網路的裝置在下一次更新之前跟其他來源共用額度，通常感覺不到，遇到攻擊時最多等一分鐘。讀不到容器時保留上一份清單，這張表不存在時埠完全開放，這裡出錯不會把人擋在外面。大流量的攻擊在塞滿主機的網路之前就要靠主機商處理，這些規則擋不了。

判讀時要知道：使用者換了網路（例如從 Wi-Fi 換到行動網路），新位址在下一次同步之前送來的握手也會被算進去，所以平常就會有少量的數字。要注意的是突然增加、來源變多，或只出現在某一個城市的節點。兩個城市一起增加，多半是一般的網路掃描。只有一個城市增加的話，再對照那個城市使用者的分布。大區看的是登記地，掃描器與代理可能在任何地方，要看的是某一區持續增加，尤其是有人從同一區連線之後才出現的情況。

## 節點打不開的網站

有些網站擋國外或機房的 IP。2026-11-08 從三台節點連 43 個常用網站：東京與新加坡節點打不開監理服務網與 momo，台北與新加坡節點打不開 Reddit 與香港郵政，新加坡節點打不開樂天市場，台灣銀行與巴哈姆特動畫瘋在東京與新加坡節點要通過驗證。使用者連上 Vessel 之後遇到這種網站，分不出是 Vessel 斷線還是網站擋了節點，所以每台節點每小時自己測一次，入口網站的服務狀態頁再依網站所在的地區列出各節點打不開的網站。

- 清單在 `reach-sites.tsv`：網站所在的地區（各地都會用到的服務、台灣、香港、澳門、日本、新加坡）、網址，以及只有真正的頁面才有的文字。Vessel 的使用者不只在台灣，所以每個地區都放幾個常用的網站，服務狀態頁依地區分組，讀者看自己那一組即可。驗證頁或封鎖頁也可能回 200，有這段文字才算打得開。從哪裡連都會被 Cloudflare 要求驗證的網站（健保署、博客來、Dcard、Claude）與靠 JavaScript 產生的頁面（TVer、ABEMA）不放進清單，curl 分不出驗證與封鎖
- `vessel-reach.py` 在容器的網路裡用 curl 連，請求從節點的公開 IP 出去，網域用不過濾的 `10.8.1.1` 查，跟使用者的路徑相同，過濾名單擋下的不會被當成打不開。東京節點主機自己的解析器查不到 `web.whatsapp.com`，所以不能直接在主機上連
- 每個網站的結果是打得開（`ok`）、要驗證（`challenge`，瀏覽器可能自動通過）或打不開（`blocked`，逾時、拒絕連線、403、沒有那段文字）。連續兩次打不開才算打不開，一次的慢回應不會出現在頁面上
- 結果寫進 `/opt/vessel-node/reach.json`，入口網站透過 `awgctl-remote reach --json` 讀取，每次的結果保留 48 小時，服務狀態頁畫出近 24 小時、一小時一格的狀態。只有網站與結果，不涉及任何使用者
- 每個網站每小時一個請求，三台節點錯開最多 20 分鐘

```bash
install -m 644 reach-sites.tsv /opt/vessel-node/
install -m 755 host/vessel-reach.py /opt/vessel-node/host/
install -m 644 host/vessel-reach.service host/vessel-reach.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now vessel-reach.timer
systemctl start vessel-reach.service && cat /opt/vessel-node/reach.json    # 立刻測一次
```

## 升級

```bash
docker tag vessel-node:latest vessel-node:pre-<日期>   # 回滾用
docker build -t vessel-node:latest /opt/vessel-node/build
/opt/vessel-node/run.sh    # 所有人斷線幾秒後自動接回
```

`Dockerfile` 寫死兩個版本：AmneziaWG 來源映像的標籤，以及 Alpine 的次版本號。Alpine 跟著最新的穩定版，unbound 用它提供的套件。重建映像會取得 Alpine 在同一個次版本內補的安全修正。換 Alpine 的次版本（新的穩定版發布時）或 AmneziaWG 的版本都是明確的一步，改 `Dockerfile`、重建映像、執行 `run.sh`。

2026-11-01 以前直接以 `amneziavpn/amneziawg-go:latest` 為基礎，裡面是 Alpine 3.19，unbound 停在 1.20.0。這一版經過遞迴的查詢不檢查 RPZ 的標記（NLnetLabs/unbound#1079，1.21 修正），合併解析器（toomore/anoni-net-ws#447）需要新版，所以改成最新穩定版的 Alpine，只從官方映像取 `amneziawg-go`、`awg`、`awg-quick`。`awg` 只依賴 musl，`amneziawg-go` 是靜態連結。

AmneziaWG 換協定世代時，舊的設定檔可能不相容，要請所有人重新建立裝置。
