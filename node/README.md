# node

Vessel 的節點。每台主機執行一個容器 `vessel-node`，裡面是 AmneziaWG 3.1 與三個 unbound 解析器，裝在主機的 `/opt/vessel-node/`。

## 檔案

| 檔案 | 放在主機的 | 用途 |
|---|---|---|
| `Dockerfile`、`start.sh` | `build/` | 官方 `amneziavpn/amneziawg-go` 映像加上 unbound 與 iptables。`start.sh` 起 AWG、加 DNS 位址、設防火牆、起三個 unbound |
| `setup.sh` | 根目錄 | 一次性安裝：建映像、產生伺服器金鑰與共用參數、下載名單、設 cron、啟動容器。已經有 `server/interface.conf` 就中止 |
| `run.sh` | 根目錄 | 重建容器 |
| `awgctl` | 根目錄，連結到 `/usr/local/sbin/awgctl` | 管理使用者 |
| `update-lists.sh` | 根目錄 | 更新 RPZ 名單並重新載入 unbound，每天由 root 的 cron 執行 |
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

`add-pubkey` 回傳 JSON，內容是設定檔除了私鑰以外的全部欄位（`interface` 與 `peer` 兩組），入口網站在瀏覽器裡補上私鑰組成設定檔。節點上不會留下這個使用者的設定檔。`Jc`、`Jmin`、`Jmax` 與 `I1` 只在客戶端作用，每個使用者各自隨機產生，`I1` 偽裝成一個 DNS 查詢。

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

## 容器內的防火牆

VPN 使用者只能上網：

- 轉送的預設政策是 DROP，只放行隧道到網際網路
- 使用者之間不能互連
- 連不到私有網段、`169.254.0.0/16`（雲端主機的中繼資料服務）、`100.64.0.0/10`、`127.0.0.0/8`、多播，以及節點自己的公開 IP。沒有擋的話，使用者可以經 Docker 閘道碰到主機的 SSH，繞過雲端防火牆
- 對外的 TCP 25 回 reset
- 從隧道連到容器本身只放行 53 埠

## 升級

```bash
docker build -t vessel-node:latest /opt/vessel-node/build
/opt/vessel-node/run.sh    # 所有人斷線幾秒後自動接回
```

AmneziaWG 換協定世代時，舊的設定檔可能不相容，要請所有人重新建立裝置。
