# deploy

入口網站的部署：nginx 提供建置好的前端，`/api/` 轉給後端。後端、worker 與 PostgreSQL 用 `docker-compose.yml` 啟動。

## 密鑰放在 /etc/vessel

密鑰不放在 repo 的目錄裡。主機通常會備份應用程式的目錄與資料庫的 dump，帳號號碼的 pepper 如果跟資料庫的備份放在一起，資料庫外洩時就保護不了帳號號碼。

| 檔案 | 內容 | 遺失的後果 |
|---|---|---|
| `/etc/vessel/api.env` | `VESSEL_DATABASE_URL`、`VESSEL_ACCOUNT_PEPPER`、`VESSEL_HMAC_KEY` | pepper 或 HMAC 金鑰遺失，所有帳號都無法登入，邀請碼也全部失效 |
| `/etc/vessel/db.env` | `POSTGRES_PASSWORD` | 可以進資料庫容器重設 |
| `/etc/vessel/ssh/key`、`known_hosts` | 呼叫節點 `awgctl-remote` 的金鑰與節點的主機金鑰 | 重新產生，再換掉節點上 `authorized_keys` 的那一行 |

連線檢測的 UDP 測試預設使用 Cloudflare 的公開 STUN 伺服器（`stun.cloudflare.com:3478`），`api.env` 加上 `VESSEL_STUN=<主機>:<埠>` 可以換成其他伺服器，設成空值就不顯示這一項。

`VESSEL_ACCOUNT_PEPPER` 與 `VESSEL_HMAC_KEY` 要另外備份在主機以外的地方，例如維護者的密碼管理器，而且不要跟資料庫的備份放在一起。三個檔案的權限都是 600，擁有者是 root。

## 第一次安裝

```bash
sudo install -d -m 700 /etc/vessel /etc/vessel/ssh
pw=$(openssl rand -hex 24)
printf 'POSTGRES_PASSWORD=%s\n' "$pw" | sudo tee /etc/vessel/db.env >/dev/null
printf 'VESSEL_DATABASE_URL=postgresql://vessel:%s@db/vessel\nVESSEL_ACCOUNT_PEPPER=%s\nVESSEL_HMAC_KEY=%s\n' \
  "$pw" "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" | sudo tee /etc/vessel/api.env >/dev/null
sudo ssh-keygen -q -t ed25519 -N '' -C vessel-portal -f /etc/vessel/ssh/key
# 節點的主機金鑰：從節點本身讀出，跟既有的 known_hosts 核對過再寫入
sudo chmod 600 /etc/vessel/*.env /etc/vessel/ssh/*

cp deploy/.env.example deploy/.env           # VESSEL_API_PORT
sudo install -d -o "$USER" /srv/vessel/web /srv/vessel/web-onion
deploy/deploy.sh
```

接著在節點的 root `authorized_keys` 加上 `/etc/vessel/ssh/key.pub`，綁定 `awgctl-remote` 並限定來源（見 `node/README.md`），再設定 region 與開關：

```bash
cd deploy
docker compose exec api python -m app.admin regions set sg --node-host <節點的 tailnet IP> --open
docker compose exec api python -m app.admin settings redeem_paused true    # 正式開放前先暫停兌換
docker compose exec api python -m app.admin settings account_cap 230
```

nginx 的設定照 `nginx/vessel.anoni.net.conf`，`proxy_pass` 的埠要跟 `deploy/.env` 的 `VESSEL_API_PORT` 一致。來源要限定只接受 Cloudflare 的 IP，後端用 `CF-Connecting-IP` 做頻率限制，繞過 Cloudflare 直接連的話，這個標頭可以被偽造。

前端在 Node 22 的容器裡建置，主機不必安裝 Node.js。

onion 版（`vessel.<onion>`，#147）是同一份前端的另一個建置（`npm run build:onion`），放在 `/srv/vessel/web-onion`，nginx 的設定照 `nginx/vessel-onion.conf`。onion 版不送統計，圖片由 onion 這側的 `/vessel-assets/` 供應，意見回覆送到表單伺服器的 onion 位址，passkey 與連線檢測改成說明。

Tor 用 unix socket 把連線交給 nginx，不經過 Cloudflare，也沒有訪客的 IP。nginx 把 `CF-Connecting-IP` 統一設成 `onion`，所有 onion 的訪客共用一份登入與兌換的額度，經 Tor 的寫入另外由 nginx 限制總量。onion 版的登入 cookie 改用不帶 `Secure` 的 `vessel`（後端看 `Host` 判斷），部分開啟 onion 位址的瀏覽器不把 http 的 .onion 當成安全連線，會拒收 `Secure` 與 `__Host-` 的 cookie，nginx 要照範本把 `Host` 傳給後端。clearnet 的設定送出 `Onion-Location` 標頭，Tor Browser 會提示可以改用 onion 版。

## 更新

```bash
deploy/deploy.sh
```

會拉最新的 main、建置前端、更新 `/srv/vessel/web` 與 `/srv/vessel/web-onion`、重建映像、先執行遷移，再重啟後端與 worker。`/etc/vessel` 的檔案只有 root 能讀，所以 compose 用 sudo 執行。重啟後端與 worker 不影響已經連上的裝置，連線只經過節點。

## 告警

worker 停擺時容器與 API 照樣是健康的，2026-10-27 就有一個多小時沒有讀到任何用量。worker 每完成一輪、每讀完一個節點的用量，都會在 `heartbeats` 表留下時間，後端在 `/internal/health` 回報這些時間與卡住的工作。這個路徑不在 `/api/` 底下，nginx 不轉送，只能從主機連後端的埠。

`deploy/health_warn.py` 讀這個端點，下列情況推播到 ntfy，只在狀態改變時推一次，恢復時再推一次：

- worker 超過 5 分鐘沒有完成一輪
- 某個節點超過 20 分鐘沒有讀到用量
- 某個節點的網站自測超過 3 小時沒有更新（節點上的 `vessel-reach.timer` 停了，見 `node/README.md` 的「節點打不開的網站」）
- 有節點工作排隊超過 15 分鐘
- 有裝置在檢測時，分析主機比對用的名單超過 24 小時沒有更新（分析主機上的 `vessel-inspect-lists.timer` 停了或下載失敗，見 `inspect/README.md` 的「名單的更新」）
- 後端沒有回應

節點打不開的網站另外比對，跟服務狀態頁一樣，只算某個節點打不開、其他節點打得開的網站。有網站新打不開或恢復時，推一則一般優先的通知，列出變化的網站。上一次的清單記在 `VESSEL_REACH_STATE`（預設 `~/.cache/vessel-reach.state`），第一次執行只記下清單，不推播。

用主機的 crontab 每 10 分鐘執行一次，`VESSEL_HEALTH_URL` 的埠跟 `deploy/.env` 的 `VESSEL_API_PORT` 一致：

```bash
*/10 * * * * VESSEL_NTFY=http://<ntfy 主機>/<topic> VESSEL_HEALTH_URL=http://127.0.0.1:<VESSEL_API_PORT>/internal/health python3 /home/ubuntu/app/vessel/deploy/health_warn.py >> /home/ubuntu/vessel-health.log 2>&1
```

加上 `--force` 手動執行一次，可以確認通知收得到。

## 濫用的跡象

節點不記錄連線的目的地與時間，所以無法從紀錄查出是哪一台裝置做了什麼。節點先擋下常見的濫用（往外的 SMTP、內網與雲端 metadata 的位址、每台裝置同時 2,000 條連線，見 `node/start.sh`），其餘靠外部的訊號。

### 出口 IP 的黑名單

`health_warn.py` 每次執行都把各城市的出口 IP（`regions set --exit-ip`，換主機期間也包括舊主機的）逐一到 DNS 黑名單查詢，被列入時推一則高優先的通知，移出時推一則一般優先的通知。預設查 SpamCop、Barracuda、DroneBL 與 PSBL，2026-11 在 m6 確認這四份都能透過主機的解析器查詢。Spamhaus 拒絕經由公用解析器的查詢，要用的話先申請免費的 DQS 金鑰，在 crontab 加上 `VESSEL_DNSBL="<預設的四份> <金鑰>.zen.dq.spamhaus.net"`。查不到結果（逾時、名單拒絕查詢）時沿用上一次的結果，原因寫在 log。上一次的結果記在 `VESSEL_DNSBL_STATE`（預設 `~/.cache/vessel-dnsbl.state`）。只查 IPv4。

改了名單之後執行一次 `python3 deploy/health_warn.py --dnsbl`，每一筆都應該是 `clear` 或 `listed`，出現 `unknown` 代表那份名單無法從這台主機查詢。

### 用量與節點的計數

`/internal/health` 的 `usage_flags` 是本月三種帳號的數量：上傳超過下載而且上傳至少 1 GB、已經用了額度的三分之一而且照目前的速度月底前會用完、已經用完額度。瀏覽、影片與訊息多半是下載，上傳多的帳號可能在架站、做種或替別人轉送。`node_totals` 是各節點從容器啟動以來的 BitTorrent 封包數與裝置連線數到上限的次數（`node/start.sh`），worker 讀用量時一起存下。

`health_warn.py` 在任何一種帳號變多時推播，節點的計數從 0 變成大於 0 時推播一次，持續增加不再推播，節點重啟歸零後再出現才會再推。都只有總數，通知裡沒有帳號或裝置，上一次的結果記在 `VESSEL_USAGE_STATE`（預設 `~/.cache/vessel-usage.state`）。收到通知之後在 m6 上查 `account_usage`，只在需要處理時看是哪個帳號，看完不另外記下。

### 連不上的裝置

使用者所在的網路擋掉節點的回應時，節點仍然收得到裝置送來的連線請求，連線卻一直沒有建立。worker 每次讀用量時，把「上一次讀取之後收到這台裝置的封包，但最近一次建立連線的時間太舊，收到的不可能是資料」的裝置算成連不上，每個城市每天最多同時有幾台記在 `daily_stats.failing_devices`，`report` 的 `failing` 欄列出。某個城市同時達到 2 台（`health_warn.py` 的 `FAILING_ALERT`），或當天比上次更多時推播。網路直接擋掉裝置送出的封包時，節點什麼都收不到，這個數字看不出來。

判斷的依據用 `tools/handshake-check/run.sh` 在本機確認過，升級 AmneziaWG 之後再執行一次。

### 被列入或收到 abuse 通知時

主機商轉來的 abuse 通知會寄到主機帳號的 email，要確認維護者看得到。處理的順序：

1. 通知裡有目的地或埠的話，先在那個節點暫時擋下，回覆主機商已經處理
2. 用 `report` 看那個城市的流量與連線裝置數，對照最近有沒有用量或節點計數的通知
3. 同一個城市一再出現，評估收緊每台裝置的連線數，或暫停兌換（`settings redeem_paused true`）
4. 到黑名單的網站申請移除，多數名單在問題停止之後也會自動移除

## Cloudflare

- 主機名稱經 Cloudflare 代理
- 對這個主機名稱關掉自動注入的 Web Analytics 與 JS Detections，頁面的 CSP 也會擋下它們
- 不快取
- `/api/login` 與 `/api/redeem` 依 IP 做速率限制
- `/dns/` 的即時檢測另外用到四個主機名稱 `vessel-dns-0` 到 `vessel-dns-3.anoni.net`，都是經代理、CNAME 到同一台主機的紀錄，nginx 的設定照 `nginx/vessel-dns.anoni.net.conf`。只回應 `/check`，只允許 `https://vessel.anoni.net` 讀取，不記存取紀錄。入口網站 CSP 的 `connect-src` 要列出這四個主機名稱

## 裝置檢測

裝置頁的檢測（`app/inspections.py`）要有分析主機才會開放。`/etc/vessel/api.env` 加上 `VESSEL_ANALYSIS_HOST=<分析主機的 tailnet IP>`，沒有設定時開始檢測回 503。入口用跟節點相同的 SSH 金鑰連線，分析主機的 `authorized_keys` 要把這把金鑰限制在 `inspect/inspect-remote`，分析主機的 host key 也要加進 `VESSEL_SSH_KNOWN_HOSTS`。節點端的設定見 `node/README.md`，分析主機見 `inspect/README.md`。
