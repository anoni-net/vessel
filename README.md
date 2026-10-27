<a id="zh-tw"></a>

# vessel

**正體中文** | [English](#en)

Vessel 是[匿名網路社群 anoni.net](https://anoni.net/) 架設的 VPN。連線使用 AmneziaWG 並加上混淆，在會阻擋 VPN 的網路上比較不容易被辨識。帳號不需要 email，用一組隨機的帳號號碼登入，裝置的金鑰在瀏覽器裡產生，私鑰不會送到社群的伺服器。

目前在開發中，之後採邀請制測試。網址是 <https://vessel.anoni.net/>。

## Vessel 能做到與做不到的事

- 你所在網路的業者只能看到你連到 Vessel 的節點，無法看到你接著連去哪裡
- 社群的節點可以看到你連往哪些網域，Vessel 不提供匿名。需要匿名時，請使用 [Tor Browser](https://www.torproject.org/)
- 節點不記錄連線的目的地與時間，DNS 解析器也不記錄查詢

## 目錄

| 目錄 | 內容 |
|---|---|
| `node/` | 節點：AmneziaWG 3.1 加上三個 unbound 解析器（不過濾、擋惡意網站、再擋廣告），以及管理使用者的 `awgctl` |
| `api/` | 入口網站的後端（FastAPI），開發中 |
| `web/` | 入口網站的前端（Vite、Preact），開發中 |

節點的 IP、伺服器金鑰與使用者的設定檔都不在 repo 裡。

## 授權

程式碼以 [MIT](LICENSE) 授權釋出。

<a id="en"></a>

# vessel

[正體中文](#zh-tw) | **English**

Vessel is a VPN run by the [anoni.net community](https://anoni.net/). It uses AmneziaWG with obfuscation, which makes it harder to recognize on networks that block VPNs. Accounts need no email: you sign in with a random account number, and device keys are generated in your browser, so private keys never reach the community's servers.

Vessel is under development and will start as an invite-only test at <https://vessel.anoni.net/>.

## What Vessel does and does not do

- Your network provider sees only that you connect to a Vessel node, not where you go from there
- The community's nodes can see which domains you connect to, so Vessel does not make you anonymous. Use [Tor Browser](https://www.torproject.org/) when you need anonymity
- Nodes keep no record of where or when you connect, and the DNS resolvers log no queries

## Layout

| Directory | Contents |
|---|---|
| `node/` | The node: AmneziaWG 3.1 with three unbound resolvers (no filtering, malware, malware and ads) and `awgctl` for managing peers |
| `api/` | Portal backend (FastAPI), in progress |
| `web/` | Portal frontend (Vite, Preact), in progress |

Node IPs, server keys and client configs are not in this repository.

## License

The code is released under the [MIT](LICENSE) license.
