# deploy

入口網站的部署：nginx 提供建置好的前端，`/api/` 轉給後端。後端、worker 與 PostgreSQL 用 `docker-compose.yml` 啟動。

## 密鑰放在 /etc/vessel

密鑰不放在 repo 的目錄裡。主機通常會備份應用程式的目錄與資料庫的 dump，帳號號碼的 pepper 如果跟資料庫的備份放在一起，資料庫外洩時就保護不了帳號號碼。

| 檔案 | 內容 | 遺失的後果 |
|---|---|---|
| `/etc/vessel/api.env` | `VESSEL_DATABASE_URL`、`VESSEL_ACCOUNT_PEPPER`、`VESSEL_HMAC_KEY` | pepper 或 HMAC 金鑰遺失，所有帳號都無法登入，邀請碼也全部失效 |
| `/etc/vessel/db.env` | `POSTGRES_PASSWORD` | 可以進資料庫容器重設 |
| `/etc/vessel/ssh/key`、`known_hosts` | 呼叫節點 `awgctl-remote` 的金鑰與節點的主機金鑰 | 重新產生，再換掉節點上 `authorized_keys` 的那一行 |

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
sudo install -d -o "$USER" /srv/vessel/web
deploy/deploy.sh
```

接著在節點的 root `authorized_keys` 加上 `/etc/vessel/ssh/key.pub`，綁定 `awgctl-remote` 並限定來源（見 `node/README.md`），再設定 region 與開關：

```bash
cd deploy
docker compose exec api python -m app.admin regions set sg --node-host <節點的 tailnet IP> --open
docker compose exec api python -m app.admin settings redeem_paused true    # 正式開放前先暫停兌換
docker compose exec api python -m app.admin settings account_cap 230
```

nginx 的設定照 `nginx/vessel.anoni.net.conf`，`proxy_pass` 的埠要跟 `deploy/.env` 的 `VESSEL_API_PORT` 一致。

## 更新

```bash
deploy/deploy.sh
```

會拉最新的 main、建置前端、更新 `/srv/vessel/web`、重建並重啟後端與 worker、執行遷移。重啟後端與 worker 不影響已經連上的裝置，連線只經過節點。

## Cloudflare

- 主機名稱經 Cloudflare 代理
- 對這個主機名稱關掉自動注入的 Web Analytics 與 JS Detections，頁面的 CSP 也會擋下它們
- 不快取
- `/api/login` 與 `/api/redeem` 依 IP 做速率限制
