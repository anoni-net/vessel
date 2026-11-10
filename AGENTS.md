# AGENTS.md

給貢獻者與 AI 工具的說明。Vessel 是匿名網路社群 anoni.net 架設的 VPN，這個 repo 包含節點、入口網站的後端與前端。

## 宗旨

Vessel 是社群為身邊的人架設的 VPN。我們看到大家在學校、旅館、出國時的上網處境與需求，投入社群的技術建立這個服務，讓大家在常連不上的地方也能放心上網。不需要 email，不用付費，有問題有人回應。

做任何功能、寫任何文字之前，先對照這四件事：

- 連得上：使用者最在意的是連得上，偽裝連線、節點與城市都是達成它的方法
- 容易：不懂技術的人也能照著完成，步驟越少越好
- 可以信任：營運者是使用者認識的社群。隱私是我們做到的事，寫清楚在隱私權政策就好，不在每一頁重複
- 有人在：意見回覆有人讀、會處理，服務的狀況公開

介面與文案先寫使用者的處境，以及 Vessel 能替他做到什麼。隱私與技術的做法，只在使用者需要做決定或需要知道後果的那一刻提一次，例如設定檔離開這頁就看不到了。其他的細節留給隱私權政策與常見問題。不要用一段段「不記錄、不保存」的說明填滿頁面，那會把焦點從使用者身上移開。

## 目錄

| 目錄 | 內容 | 常用指令 |
|---|---|---|
| `node/` | 節點的容器與 `awgctl`，說明見 `node/README.md` | `bash -n`、`shellcheck -S warning` |
| `api/` | 入口網站的後端，FastAPI 與 PostgreSQL 18 | `uv sync`、`uv run pytest -q`、`uv run ruff check .`、`uv run python -m app.migrate` |
| `web/` | 入口網站的前端，Vite、Preact、TypeScript | `npm ci`、`npm run dev`、`npm run typecheck`、`npm run build`、`npm test` |
| `deploy/` | 後端的 compose、部署腳本、nginx 設定範例，部署步驟見 `deploy/README.md` | `deploy/deploy.sh` |
| `relay/` | 其他團體營運的入口：`vessel-relay` 用 nftables 把 UDP 轉送到節點，營運規範在 `relay/NORMS.md` | `sudo bash relay/test/netns-test.sh` |
| `inspect/` | 裝置流量檢測的分析端：接收節點的封包、自動分析、產生結果，說明見 `inspect/README.md` | `python3 -m unittest discover -s inspect/tests` |
| `tools/dpi-check/` | 在本機檢查 AmneziaWG 的偽裝在 DPI 工具眼中的樣子，改了混淆參數或升級 AmneziaWG 之後執行，說明見 `tools/dpi-check/README.md` | `tools/dpi-check/run.sh` |

首頁「Vessel 的做法」的四張圖（FIG. 02 到 05）由 `web/scripts/hero-figures.py` 產生，寫進 `web/src/hero-figures-data.ts`，要改圖時改腳本再執行 `python3 web/scripts/hero-figures.py`，不要手改資料檔。標籤的寬度取自三個語系的文字，改了圖上標籤的文字也要重新執行，CI 會用 `--check` 確認資料檔與腳本畫出的一致。

檢測報告的網站說明在 `web/src/data/site-notes.json`，跟著前端打包，報告在使用者的瀏覽器裡比對命中的網站，不逐一查詢伺服器。說明只補充，不影響報告的判斷，名單頁（`/dns/lists/#site-notes`）公開整份資料。新增一筆時寫上網域、類別、營運者（選填）、至少一個 `https://` 來源與審查日期，新的類別要在三個語系補上 `notes.<類別>.name` 與 `.about`。說明有增減時，在名單頁的變動紀錄（`web/src/pages/dns-lists.tsx` 的 `LOG`）加一行。CI 用 `node web/scripts/site-notes.mjs` 檢查格式，審查日期超過一年會失敗，重新確認來源後更新日期。

`npm run build` 建置之後會預先渲染每一頁（`web/scripts/prerender.mjs`），每個語系、每個頁面各有一份帶著自己標題、描述與連結預覽的 HTML，另外產生 `404.html`、`robots.txt` 與 `sitemap.xml`。正式網站的 nginx 只回應這些檔案，其他路徑回 404，所以新增頁面時要加進 `web/src/seo.ts` 的 `PUBLIC_PAGES`（可以被搜尋到）或 `PRIVATE_PAGES`（要登入，標成 `noindex`），清單跟 App 的路由對不上時建置會失敗。

開發時前端用 `npm run dev`，`/api/` 會轉到 `127.0.0.1:8090` 的後端。前端的 Playwright 測試用 `page.route` 模擬後端，只需要建置好的前端，在桌機與手機兩種尺寸各執行一次。改了畫面之後，在手機尺寸實際截圖看過再送出。

後端的測試要連真的 PostgreSQL，用環境變數 `VESSEL_TEST_DATABASE_URL` 指定，測試會重建它的 `public` schema，不要指到正式的資料庫。沒有設定時，需要資料庫的測試會跳過。

```bash
docker run -d --rm --name vessel-pg-test -e POSTGRES_PASSWORD=t -e POSTGRES_DB=vessel -p 127.0.0.1:55432:5432 postgres:18.6-alpine3.24
VESSEL_TEST_DATABASE_URL=postgresql://postgres:t@127.0.0.1:55432/vessel uv run pytest -q
```

維護者的指令在後端的主機上執行，沒有管理網頁：`python -m app.admin invites create --count N`、`regions set <ID> --node-host <tailnet IP> --open [--exit-ip <節點的公開 IP>]`、`regions move <ID> --node-host <新主機的 tailnet IP> --exit-ip <新主機的公開 IP> --until <舊主機關閉的日期>`、`settings [鍵 值]`（`account_cap`、`redeem_paused`、`user_invites` 與 `monthly_quota_gb`）、`relays [set <ID> --region <城市> --endpoint <host:port> --open|--closed]`、`stats`、`report [--days N]`、`notices [add|end|delete]`、`groups [create|set|leader-invite|remove-leader|close]`。`report` 印出測試期每週檢視用的總數，以及 `daily_stats` 最近幾天的紀錄，只有總數，不列出任何帳號或裝置。`--exit-ip` 給連線檢測（`/check/`）用：`/api/exit` 把請求的來源 IP 跟各城市的出口 IP 比對，只回傳是哪個城市，不保存來源 IP。出口 IP 就是節點 `node.env` 的 `NODE_IP`，只存在資料庫，不寫進 repo。`notices` 寫入服務狀態頁（`/status/`）的維護與中斷紀錄，例如重啟節點之前 `notices add sg restart --minutes 5`，頁面列出最近 30 天的紀錄。`regions move` 給城市換主機用：新主機沿用舊主機的伺服器金鑰與 peers，入口網站改指新主機，當下已經存在的裝置標成「需要新的設定檔」，裝置頁提醒使用者在 `--until` 之前新增裝置、刪除舊的，連線檢測在那天之前也認得舊主機的出口 IP。`groups` 管理團體（規劃見 toomore/anoni-net-ws#464）：團體只存代號，`list` 只列出設定與總數，不列出代稱、裝置名稱與異常狀態。`leader-invite` 印出負責人的邀請碼，兌換後得到一個屬於團體的新帳號，邀請碼本身不留下對應。團體的帳號用團體的裝置數、流量與期限，不計入 `account_cap`，不受 `redeem_paused` 影響，也不能產生使用者邀請碼。`groups remove-leader` 刪除負責人的帳號與裝置，用在負責人離開或不再可信時，負責人彼此不能在頁面上移除。`groups close` 讓團體進入結束期（預設 30 天，`--until` 指定日期），未使用的邀請碼作廢，當天 worker 刪除帳號、裝置與團體，`--now --confirm <代號>` 立刻結束，`--cancel` 取消。`groups set <代號> --inspections N` 讓負責人最多同時對 N 台成員的裝置提出檢測請求（規劃見 toomore/anoni-net-ws#483），預設 0 是不提供。成員同意並在裝置上確認之後才開始，負責人看到的摘要用負責人瀏覽器產生的鑰匙加密，只有判定與類別（`app/groups.py`、`app/inspections.py`）。負責人頁面、團體版的同意頁與隱私權政策完成之前，每個團體都維持 0。負責人在 `/group/`（`app/groups.py`、`web/src/pages/group.tsx`）發放成員邀請碼、撤銷裝置與回收名額，撤銷與回收都要經過確認畫面，回收名額會刪除帳號，另外要確認身分。`relays` 是中繼路線（anoni-net/vessel#136）：一個入口把 UDP 原封不動轉送到某個城市的節點，節點仍是出口，不解開通道。透過中繼建立的裝置在節點上是那個城市的一般 peer，只有設定檔的 `Endpoint` 換成中繼的位址，由後端在交出設定檔時改寫。`/api/relays` 只回傳開放中的路線與它通往的城市，不回傳位址。中繼轉送的目標是節點的公開 IP，城市換主機時要另外到中繼那邊手動改，`regions move` 會列出受影響的中繼，透過中繼的裝置不必換設定檔。各城市的「正常」、「無法連線」由 worker 最後一次讀到節點的時間判斷，門檻跟 `deploy/health_warn.py` 相同。網域過濾頁的網站查詢（`/api/blocklist`）用後端記憶體裡的一份名單比對：`app/blocklists.py` 下載跟節點相同的兩份 HaGeZi 名單，後端啟動時與每 8 小時更新一次，下載失敗就保留上一份。查詢的網域用 POST 送出，只在當下比對，不記錄也不保存。

節點的工作（新增與移除 peer）先寫進 `jobs`，API 當下試一次，失敗就交給 `python -m app.worker` 重試。新增與恢復試 10 次就放棄，移除、暫停與限速會一直重試到節點回應為止，刪掉的裝置留在節點上就還能連線。worker 每小時比對一次各節點的 peer 與 `devices`，名稱是裝置 ID 格式、資料庫裡卻沒有的 peer 排進移除，一次超過 5 個時只印出警告，留給維護者判斷是不是接錯了資料庫。worker 也負責讓過期的裝置下線、清掉沒被取走的設定檔、刪除完成超過 24 小時的工作（只留還在的裝置新增失敗的那一筆），並每 5 分鐘讀一次節點的流量計數，換算成增量累計到帳號的當月用量。帳號用完額度時，它的裝置在節點上限速到每台約 2 Mbps（`awgctl throttle`），仍然連得上，下個月（UTC）恢復全速。節點重啟會失去限速規則，worker 讀流量時比對節點回報的 `throttled`，補上少掉的、拿掉不該有的。限速期間不能新增裝置。每次讀完一個節點，worker 也更新 `daily_stats` 當天那個城市的總數：最後握手在今天的裝置數（直接看節點的握手時間，不替裝置另外存時間）、流量，以及到期的裝置數，保存 400 天。節點第一次回報某台裝置的握手時，worker 把那台裝置記成「連上過」，只有是或否，`report` 用它算出建立之後真的連上的比例，裝置頁也用它提示還沒連上的裝置。worker 每 30 分鐘另外讀一次各節點打不開哪些常用網站（節點每小時自測，見 `node/README.md` 的「節點打不開的網站」），存進 `reach`，每次的結果另外存進 `reach_history` 保留 48 小時。服務狀態頁用近 24 小時的紀錄畫出每個網站在各節點一小時一格的狀態，只列出某個節點打不開、其他節點打得開的網站，連線檢測只連到那一節。測試用 `app.nodes.set_node()` 換成假的節點。

## 不能進 repo 的東西

repo 是公開的。下面這些只放在主機上：

- 節點的 IP 與埠（`node.env`）、中繼的位址、伺服器私鑰、`HeaderProtectionKey`、使用者的設定檔
- 後端的資料庫密碼、帳號號碼的 pepper、HMAC 金鑰（主機的 `/etc/vessel/`）
- 任何使用者的資料，包括測試時建立的帳號與裝置

## 隱私的設計原則

改動時不要打破這幾條，它們也寫在使用條款與隱私權政策裡：

- 裝置的私鑰在瀏覽器裡產生，不送到伺服器。後端只經手公鑰與 PresharedKey，PresharedKey 交給節點之後就不保存
- 不收 email 或任何聯絡方式，帳號號碼只存 Argon2id 雜湊
- 不記錄誰邀請了誰。使用者在帳號頁產生的邀請碼（`app/invites.py`，每個帳號的組數是設定 `user_invites`，0 是關閉）只在還沒被使用時記著是哪個帳號產生的，兌換或過期之後就清掉，帳號只留「已經有幾位使用」的計數
- passkey 是帳號號碼以外的登入方式（`app/passkeys.py`），RP ID 是 `vessel.anoni.net`。後端只存公鑰、簽章計數、使用者取的名稱與加入日期，不存 AAGUID，`user.id` 是替帳號另外產生的隨機值。換一組帳號號碼一定要當下用這個帳號的 passkey 簽一次，換完之後其他登入中的 session 一律刪除。加上或刪除 passkey、刪除帳號要在登入後 10 分鐘內，超過時先用 passkey 或帳號號碼再確認一次（`app/auth.py` 的 `require_recent`、`web/src/pages/reverify.tsx`），短暫拿到已登入瀏覽器的人無法加上自己的 passkey 再換掉號碼
- 入口網站、API 與節點都不記錄存取紀錄、連線的目的地與時間，節點的 DNS 解析器不記錄查詢。唯一的例外是使用者自己開啟的裝置檢測
- 裝置檢測（`app/inspections.py`、`web/src/pages/inspect.tsx`，規劃見 toomore/anoni-net-ws#480）只在使用者同意蒐集項目，並在那台裝置上打開確認連結之後開始，節點由通道位址認出裝置，最長 7 天。節點把連線複製到分析主機（`inspect/`），封包分析完立刻刪除。報告用使用者瀏覽器產生的鑰匙加密，資料庫只有密文，檢測結束後保存 7 天，到期刪除，同意的紀錄只留版本與日期。負責人看不到報告，也不知道有人開啟檢測。改了蒐集的項目時，要一起改 `policy.INSPECT_CONSENT_VERSION`、同意頁與隱私權政策的「裝置檢測」
- 團體的負責人看得到帳號代稱、裝置名稱、城市、過濾等級與異常類別，看不到流量、擋下次數、連線時間與帳號號碼。異常狀態只回傳類別，帳號頁讓成員看到負責人看到的同一份內容（`/api/group/mine`）
- 頁面不載入第三方的腳本與字型。統計送到社群自架的 Umami（`web/src/analytics.ts`），只有公開頁面的瀏覽，以及兌換、登入、建立裝置每一步的結果。事件只能帶 `EVENTS` 列出的欄位與值。資料庫記著帳號的建立日期，Umami 又替每個事件加上由 IP 推算的國家，所以事件不帶資料庫裡也有的欄位，例如帳號號碼、裝置名稱、城市與網域過濾，避免兩邊的資料能互相對照

## 節點

`node/` 是節點部署檔的權威來源，改節點時先改這裡，再部署到主機。增刪使用者時用 `awg syncconf`，不能重啟容器，否則所有人都會斷線。

## 圖片

圖片不進 repo，包括標誌與 favicon。檔名加上內容雜湊，上傳到 m6 的 `/srv/images-anoni-net/vessel/`，頁面引用 `https://assets.anoni.net/vessel/` 的網址（`web/src/images.ts`）。換圖時用新的檔名上傳，再改引用，Cloudflare 的舊快取才不會留著舊圖。CSP 的 `img-src` 只開放這個目錄。

## 寫作

說明文件與介面文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)。介面有正體中文、简体中文與英文，新增字串時三個語系的 `web/src/i18n/*.json` 要一起補，鍵值要一致。

## commit 與 PR

每個 PR 處理一件事，PR 內文寫清楚改了什麼、怎麼驗證。規劃與待決定的事項記錄在維護者的內部 issue。
