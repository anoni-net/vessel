<a id="zh-tw"></a>

# 安全通報

**正體中文** | [English](#en)

發現 Vessel 的漏洞時，請先私下告訴我們，修正之前不要公開細節。通報不需要留真實姓名。

## 通報方式

1. GitHub 的私下通報：到[這個 repo 的通報頁](https://github.com/anoni-net/vessel/security/advisories/new)填寫，只有維護者看得到內容，修正也在同一個地方討論
2. Email：寄到社群的信箱 `whisper@anoni.net`，內容請用社群的 [PGP 公鑰](https://anoni.net/B7DF84305C7911D90D59A66061F66CF36EE386D4.asc)加密，指紋是 `B7DF 8430 5C79 11D9 0D59 A660 61F6 6CF3 6EE3 86D4`
3. Matrix：到社群的 [Matrix 聊天室](https://matrix.to/#/#community:im.anoni.net)，請維護者開一個加密的私訊，細節只寫在私訊裡，不要貼在聊天室

請盡量附上受影響的元件與版本（commit）、重現的步驟，以及你判斷的影響範圍。

## 範圍

- 這個 repo 的程式：節點（`node/`）、入口網站的後端（`api/`）與前端（`web/`）、部署設定（`deploy/`）、中繼（`relay/`）、裝置檢測的分析端（`inspect/`）
- 社群營運的服務：<https://vessel.anoni.net/>、它的 onion 網站，以及各城市的節點

AmneziaWG、unbound 這類上游專案本身的漏洞，請通報給上游。它們影響到 Vessel 的使用者時，也歡迎告訴我們，我們會先處理 Vessel 這一端。其他團體營運的中繼，主機由營運的團體負責，`vessel-relay` 腳本本身的問題仍然在範圍內。

## 測試的限制

- 只用自己的帳號與裝置測試，不要存取、修改或刪除其他使用者的資料
- 不要對節點與入口網站做壓力測試或阻斷服務攻擊，也不要大量掃描，節點是大家正在使用的連線
- 不要對社群成員或使用者做社交工程
- 意外取得其他人的資料時，停止測試，在通報裡說明，並刪除手上的副本

## 處理方式

Vessel 由社群的志工維護。收到通報後，我們會在 7 天內回覆，確認是否為漏洞與預計的處理方式，修正的進度在同一個通報裡更新。

修正部署之後，我們在 GitHub 的 Security Advisory 公開說明，需要的話申請 CVE。影響到使用者時，在[服務狀態頁](https://vessel.anoni.net/status/)或帳號的站內信箱通知，例如需要重新建立裝置的設定檔。通報者願意的話，我們會在說明裡致謝，也可以不具名。

照這份說明、以善意進行研究與通報的人，社群不會追究法律責任。

<a id="en"></a>

# Security policy

[正體中文](#zh-tw) | **English**

If you find a vulnerability in Vessel, please tell us privately first and keep the details to yourself until it is fixed. You do not need to give your real name.

## How to report

1. GitHub private reporting: use [this repository's report form](https://github.com/anoni-net/vessel/security/advisories/new). Only the maintainers can read it, and the fix is discussed there too.
2. Email: write to the community at `whisper@anoni.net`, encrypted to the community's [PGP key](https://anoni.net/B7DF84305C7911D90D59A66061F66CF36EE386D4.asc), fingerprint `B7DF 8430 5C79 11D9 0D59 A660 61F6 6CF3 6EE3 86D4`.
3. Matrix: join the community's [Matrix room](https://matrix.to/#/#community:im.anoni.net) and ask a maintainer to open an encrypted direct message. Put the details only in that message, never in the room.

Where you can, include the component and version (commit) affected, steps to reproduce, and what you think the impact is. Reports in English, Traditional Chinese or Simplified Chinese are all welcome.

## Scope

- The code in this repository: the node (`node/`), the portal's backend (`api/`) and frontend (`web/`), the deployment files (`deploy/`), relays (`relay/`) and the analysis side of device inspection (`inspect/`)
- The services the community runs: <https://vessel.anoni.net/>, its onion site, and the node in each city

Vulnerabilities in upstream projects such as AmneziaWG and unbound belong with those projects. If one affects Vessel's users, please tell us as well, so we can protect Vessel's side first. Relays run by other groups are those groups' hosts, but problems in the `vessel-relay` script itself are in scope.

## While testing

- Use only your own account and devices. Do not access, change or delete other users' data
- Do not load-test, attack the availability of, or mass-scan the nodes and the portal: people are using those connections
- No social engineering of community members or users
- If you come across someone else's data, stop, say so in your report, and delete your copy

## What we do

Vessel is maintained by community volunteers. We reply within 7 days to confirm whether the report is a vulnerability and how we plan to handle it, and post progress in the same report.

Once a fix is deployed, we publish a GitHub Security Advisory and request a CVE where it applies. When users are affected, we tell them on the [status page](https://vessel.anoni.net/status/) or in their account's inbox, for example when they need a new configuration for a device. We thank reporters in the advisory if they wish, by name or anonymously.

We will not pursue legal action against anyone who researches and reports in good faith under this policy.
