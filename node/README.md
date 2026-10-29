# node

Vessel 的節點。每台主機執行一個容器 `vessel-node`，裡面是 AmneziaWG 3.1 與三個 unbound 解析器，裝在主機的 `/opt/vessel-node/`。

## 檔案

| 檔案 | 放在主機的 | 用途 |
|---|---|---|
| `Dockerfile`、`start.sh` | `build/` | 官方 `amneziavpn/amneziawg-go` 映像加上 unbound 與 iptables。`start.sh` 起 AWG、加 DNS 位址、設防火牆、起三個 unbound |
| `setup.sh` | 根目錄 | 一次性安裝：建映像、產生伺服器金鑰與共用參數、下載名單、設 cron、啟動容器。已經有 `server/interface.conf` 就中止 |
| `run.sh` | 根目錄 | 重建容器 |
| `awgctl` | 根目錄，連結到 `/usr/local/sbin/awgctl` | 管理使用者 |
| `update-lists.sh` | 根目錄 | 更新 RPZ 名單，網域有變才重新載入 unbound。root 的 cron 每 8 小時執行（UTC 04:37、12:37、20:37），跟 HaGeZi 名單標示的有效期限一致 |
| `unbound/*.conf` | `unbound/` | 三個解析器的設定 |
| `node.env.example` | 複製成 `node.env` | 節點的公開 IP 與 AWG 的埠，不進 repo |

主機上另外有 `server/`（伺服器私鑰與 `HeaderProtectionKey`）、`peers/`、`clients/`、`conf/awg0.conf` 與 `rpz/`，都不進 repo。

## 安裝

需要 Docker 與 Python 3。雲端防火牆只開 AWG 的 UDP 埠，SSH 限定來源。

```bash
mkdir -p /opt/vessel-node/build /opt/vessel-node/unbound
# 把 Dockerfile、start.sh 放進 build/，unbound/*.conf 放進 unbound/，其他檔案放在根目錄
cp node.env.example /opt/vessel-node/node.env   # 填上 NODE_IP 與 LISTEN_PORT
bash /opt/vessel-node/setup.sh
```

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
| `10.8.1.253` | 擋惡意網站 | [HaGeZi](https://github.com/hagezi/dns-blocklists) Threat Intelligence Feeds（mini） |
| `10.8.1.254` | 再擋廣告 | 上面那份，加上 HaGeZi Multi（Normal） |

三個 unbound 都不記錄查詢，開 DNSSEC 驗證與 QNAME 最小化，只接受隧道內的查詢。兩份名單載入後約佔 700 MB 記憶體，節點至少要 2 GB。

### 擋下次數

裝置頁顯示每台裝置本月有幾次查詢被惡意網站的名單擋下，節點只計數，不記錄網域。兩個有過濾的解析器對這份名單開了 `rpz-signal-nxdomain-ra`，擋下的回應是清掉 RA 旗標的 NXDOMAIN，一般的回應不會這樣。`start.sh` 建立 `VESSEL-BLOCKED` 這條 chain，每個隧道位址（`.2` 到 `.249`）一條規則，用 `u32` 比對 DNS 標頭，只累計封包數。廣告名單擋下的不算，因為數字是用來發現裝置的異常。

`awgctl` 把位址配給新的 peer 時歸零那條規則，`usage --json` 依位址帶出 `blocked`。計數跟著位址走，暫停與恢復不會歸零，容器重啟時歸零，入口網站的 worker 用跟流量相同的方式換算成增量。改了 `start.sh` 要重建映像再執行 `run.sh`，所有人會短暫斷線。

入口網站的 `/dns/` 有即時檢測，讓使用者確認目前生效的過濾。四個測試網址 `vessel-dns-0` 到 `vessel-dns-3.anoni.net` 是真的網域，三個解析器用 `local-zone ... always_nxdomain` 各藏起其中幾個：

| 測試網址 | 不過濾 | 擋惡意網站 | 再擋廣告 |
|---|---|---|---|
| `vessel-dns-0` | 正常解析 | 正常解析 | 正常解析 |
| `vessel-dns-1` | 回 NXDOMAIN | 回 NXDOMAIN | 回 NXDOMAIN |
| `vessel-dns-2` | 正常解析 | 回 NXDOMAIN | 回 NXDOMAIN |
| `vessel-dns-3` | 正常解析 | 正常解析 | 回 NXDOMAIN |

有過濾的兩個解析器另外對 `use-application-dns.net` 回 NXDOMAIN。這是 Firefox 的偵測網域，Firefox 每次啟動與切換網路時查詢它，查不到就關掉預設開啟的 DNS over HTTPS，查詢才會繼續經過 Vessel、讓過濾生效。不過濾的解析器不回應這個訊號，因為它的意思是「這個網路有過濾」。使用者手動指定其他安全 DNS 服務時不受影響，過濾仍然不會生效。

改了 `unbound/*.conf` 之後，複製到節點的 `/opt/vessel-node/unbound/`，再 `docker exec vessel-node pkill -HUP -x unbound` 重新載入。設定檔是掛進容器的，不必重啟容器，連線不會中斷。重新載入時要重讀名單，DNS 會停頓幾秒。

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
