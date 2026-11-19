<a id="zh-tw"></a>

# 參與 Vessel

**正體中文** | [English](#en)

歡迎回報問題、提出建議或送出修改。中文與英文都可以。

## 回報問題

- 一般的錯誤與建議：開一則 [GitHub issue](https://github.com/anoni-net/vessel/issues)，寫下發生了什麼、預期的結果、使用的裝置與 App，以及能重現的步驟。不要貼上帳號號碼、設定檔或任何金鑰
- 不想用 GitHub 的使用者：在網站的[意見回饋頁](https://vessel.anoni.net/feedback/)留言，或到社群的 [Matrix 聊天室](https://matrix.to/#/#community:im.anoni.net)
- 安全性問題：不要開公開的 issue，照 [SECURITY.md](SECURITY.md) 私下通報

維護者會在 issue 回覆，處理的進度也記在同一則 issue。

## 送出修改

1. 先開 issue 說明想改什麼，較大的修改先討論方向
2. fork 之後開分支，每個 PR 只處理一件事
3. PR 的內文寫清楚改了什麼、如何驗證
4. CI 全部通過，維護者審查之後合併

開發的方式、目錄的分工、隱私的設計原則與各部分的常用指令，寫在 [AGENTS.md](AGENTS.md)。改動不能打破那裡列出的隱私原則。說明文件與介面文字照社群的[寫作風格規範](https://anoni.net/join/writing-style/)，介面的字串三個語系要一起補。

## 測試

新增功能或修正錯誤時，要一起加上能驗證它的自動化測試，並在 PR 裡說明。CI 會在每個 PR 執行這些測試，沒有通過不會合併：

- 後端（`api/`）：`uv run pytest -q`，需要資料庫的測試見 AGENTS.md
- 前端（`web/`）：`npm run typecheck`、`npm test`
- 節點（`node/`）：`node/test/` 底下的腳本，加上 `shellcheck -S warning`
- 裝置檢測的分析端（`inspect/`）：`python3 -m unittest discover -s inspect/tests`

只能在正式主機上確認的部分（例如節點的部署），在 PR 裡寫下驗證的方式與結果。

## 程式檢查

CI 執行 ruff、TypeScript 的型別檢查與 shellcheck，警告要修正，不要關掉。CodeQL 每次合併與每週檢查一次，結果在 Security 分頁，中度以上的問題要處理，或寫明不適用的理由。

<a id="en"></a>

# Contributing to Vessel

[正體中文](#zh-tw) | **English**

Bug reports, ideas and changes are welcome, in English or Chinese.

## Reporting a problem

- Bugs and ideas: open a [GitHub issue](https://github.com/anoni-net/vessel/issues) with what happened, what you expected, your device and app, and the steps to reproduce it. Never paste an account number, a configuration or any key
- If you would rather not use GitHub: leave a message on the site's [feedback page](https://vessel.anoni.net/feedback/) or in the community's [Matrix room](https://matrix.to/#/#community:im.anoni.net)
- Security issues: do not open a public issue; report privately as described in [SECURITY.md](SECURITY.md)

Maintainers answer in the issue and keep its progress there.

## Sending a change

1. Open an issue first to say what you want to change, and discuss the direction of larger changes
2. Fork, branch, and keep each pull request to one thing
3. Say in the pull request what changed and how you checked it
4. It is merged once CI passes and a maintainer has reviewed it

How the project is developed, what each directory holds, the privacy principles and the usual commands are in [AGENTS.md](AGENTS.md) (in Chinese). A change must not break the privacy principles listed there. Interface strings are added in all three languages together.

## Tests

A new feature or a bug fix comes with automated tests that check it, mentioned in the pull request. CI runs them on every pull request, and nothing is merged until they pass:

- Backend (`api/`): `uv run pytest -q`; the database tests are described in AGENTS.md
- Frontend (`web/`): `npm run typecheck` and `npm test`
- Nodes (`node/`): the scripts in `node/test/`, and `shellcheck -S warning`
- Device inspection analysis (`inspect/`): `python3 -m unittest discover -s inspect/tests`

For what can only be checked on the production hosts, such as deploying a node, describe in the pull request how you checked it and what you found.

## Code checks

CI runs ruff, the TypeScript type check and shellcheck; warnings are fixed, not turned off. CodeQL runs on every merge and weekly, with results in the Security tab; findings of medium severity or higher are fixed, or dismissed with the reason they do not apply.
