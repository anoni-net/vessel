# AGENTS.md

給貢獻者與 AI 工具的說明。Vessel 是匿名網路社群 anoni.net 架設的 VPN，這個 repo 包含節點、入口網站的後端與前端。

## 目錄

| 目錄 | 內容 | 常用指令 |
|---|---|---|
| `node/` | 節點的容器與 `awgctl`，說明見 `node/README.md` | `bash -n`、`shellcheck -S warning` |
| `api/` | 入口網站的後端，FastAPI 與 PostgreSQL 18 | `uv sync`、`uv run pytest -q`、`uv run ruff check .`、`uv run python -m app.migrate` |
| `web/` | 入口網站的前端，Vite、Preact、TypeScript | `npm ci`、`npm run dev`、`npm run typecheck`、`npm run build`、`npm test` |
| `deploy/` | 後端的 compose、nginx 設定範例、環境變數範例 | |

開發時前端用 `npm run dev`，`/api/` 會轉到 `127.0.0.1:8090` 的後端。前端的 Playwright 測試用 `page.route` 模擬後端，只需要建置好的前端，在桌機與手機兩種尺寸各執行一次。改了畫面之後，在手機尺寸實際截圖看過再送出。

後端的測試要連真的 PostgreSQL，用環境變數 `VESSEL_TEST_DATABASE_URL` 指定，測試會重建它的 `public` schema，不要指到正式的資料庫。沒有設定時，需要資料庫的測試會跳過。

```bash
docker run -d --rm --name vessel-pg-test -e POSTGRES_PASSWORD=t -e POSTGRES_DB=vessel -p 127.0.0.1:55432:5432 postgres:18.6-alpine3.24
VESSEL_TEST_DATABASE_URL=postgresql://postgres:t@127.0.0.1:55432/vessel uv run pytest -q
```

維護者的指令在後端的主機上執行，沒有管理網頁：`python -m app.admin invites create --count N`、`regions set <ID> --node-host <tailnet IP> --open`、`settings [鍵 值]`、`stats`。

節點的工作（新增與移除 peer）先寫進 `jobs`，API 當下試一次，失敗就交給 `python -m app.worker` 重試。worker 也負責讓過期的裝置下線、清掉沒被取走的設定檔，並每 5 分鐘讀一次節點的流量計數，換算成增量累計到帳號的當月用量。帳號用完額度時，它的裝置在節點上暫停，下個月（UTC）恢復。測試用 `app.nodes.set_node()` 換成假的節點。

## 不能進 repo 的東西

repo 是公開的。下面這些只放在主機上：

- 節點的 IP 與埠（`node.env`）、伺服器私鑰、`HeaderProtectionKey`、使用者的設定檔
- 後端的資料庫密碼、帳號號碼的 pepper、HMAC 金鑰（`deploy/.env`）
- 任何使用者的資料，包括測試時建立的帳號與裝置

## 隱私的設計原則

改動時不要打破這幾條，它們也寫在使用條款與隱私權政策裡：

- 裝置的私鑰在瀏覽器裡產生，不送到伺服器。後端只經手公鑰與 PresharedKey，PresharedKey 交給節點之後就不保存
- 不收 email 或任何聯絡方式，帳號號碼只存 Argon2id 雜湊
- 入口網站、API 與節點都不記錄存取紀錄、連線的目的地與時間，節點的 DNS 解析器不記錄查詢
- 頁面不載入第三方的腳本、字型或統計

## 節點

`node/` 是節點部署檔的權威來源，改節點時先改這裡，再部署到主機。增刪使用者時用 `awg syncconf`，不能重啟容器，否則所有人都會斷線。

## 寫作

說明文件與介面文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)。介面有正體中文、简体中文與英文，新增字串時三個語系的 `web/src/i18n/*.json` 要一起補，鍵值要一致。

## commit 與 PR

每個 PR 處理一件事，PR 內文寫清楚改了什麼、怎麼驗證。規劃與待決定的事項記錄在維護者的內部 issue。
