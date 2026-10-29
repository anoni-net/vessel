# DPI 檢查

檢查 Vessel 的 AmneziaWG 連線在 DPI 工具眼中的樣子。改了 `node/setup.sh` 的共用參數、`node/awgctl` 產生 `I1` 與 `Jc` 的方式，或升級 AmneziaWG 之後，執行一次確認偽裝沒有退步。整個測試在本機的容器裡完成，不連到任何節點，也不會建立正式的 peer。

```bash
tools/dpi-check/run.sh            # 結果寫在 tools/dpi-check/out/，不進 repo
```

## 做法

腳本執行兩輪，每輪在兩個容器裡各起一個 AmneziaWG 伺服器與用戶端：

- 一般 WireGuard：不帶任何混淆參數，伺服器一樣在 UDP 443，當作對照
- Vessel：伺服器用 `node/setup.sh` 的參數，用戶端用 `node/awgctl` 的 `client_params()` 產生，測的就是節點實際在用的邏輯

用戶端握手之後，經過隧道送 400 個 1,200 bytes 的 ping。伺服器那一端的 `tcpdump` 只錄 UDP 443，跟路上的設備看到的一樣。最後用 nDPI 與 tshark 判讀，印出一張表，同時存成 `out/result.md`。

| 欄位 | 意思 |
|---|---|
| nDPI 的判定、分類 | nDPI 認為這是什麼協定。一般 WireGuard 會是 `WireGuard`、`VPN`，Vessel 要是一般的網頁流量 |
| 判定用的封包數 | nDPI 看了幾個封包就下結論 |
| 風險標記 | nDPI 標出的可疑之處 |
| tshark 標成格式錯誤 | 會解析 QUIC 的工具認為不合格式的比例 |
| 第一個封包之後的 QUIC 長標頭 | 真的 QUIC 握手完成後只用短標頭，這個比例越高，越容易被深入解析的設備看出異狀 |

2026-10-29 的結果是 Vessel 被判成 `QUIC`、`Web`，格式錯誤 12%、長標頭 48%，跟 2026-10-28 在新加坡節點上的實測一致。後兩項來自 AmneziaWG 資料封包的第一個位元組是隨機的，目前沒有參數可以控制。

## 分析用的映像

第一次執行會用 `Dockerfile` 建一個帶 nDPI 6.0（從原始碼建置，Debian 的套件太舊）、tshark 與 tcpdump 的映像，名稱是 `vessel-dpi`。Debian 的下載慢時，可以換成近一點的鏡像站，或改用已經建好的映像：

```bash
DEBIAN_MIRROR=http://ftp.tw.debian.org/debian tools/dpi-check/run.sh
DPI_TOOLS_IMAGE=<已經有的映像> tools/dpi-check/run.sh
```

需要 Docker 與 `/dev/net/tun`。金鑰在執行時產生，跟容器一起丟掉。

## 限制

nDPI 是開源的特徵比對函式庫，很多防火牆與流量分析產品用它，但商用設備與國家級的審查系統可能有自己的規則。這個檢查回答的是「依特徵比對認不認得出來」，回答不了統計式的偵測（長時間連到同一個 IP、封包大小的分布），也回答不了整個 UDP 被擋的網路。那些要靠使用者在實際的網路裡回報。
