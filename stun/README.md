# STUN 伺服器

連線檢測（`/check/`）發現連線沒有經過 Vessel 時，會測試目前的網路能否送出 UDP。Vessel 的節點用 AmneziaWG，走 UDP 443，網路擋下 UDP 時就連不上。瀏覽器無法直接送 UDP 封包，只能透過 WebRTC 向 STUN 伺服器發 Binding 請求，收到回應就代表 UDP 可以往返。

`stun.py` 是給這個檢測用的 STUN 伺服器，只用 Python 標準函式庫，只回應 RFC 5389 的 Binding 請求，其他封包一律丟棄，不回應也不轉送。回應裡帶著請求的來源位址（XOR-MAPPED-ADDRESS），這是 STUN 的用途，伺服器不記錄位址，也不計數，只在啟動時印一行訊息。

## 放在哪裡

STUN 要放在節點以外的主機。頁面會把 STUN 的位址交給每一位訪客，放在節點上等於公開節點的 IP。預設聽 UDP 443，跟節點相同，測出來的結果最接近實際連線。通過不保證能連上 Vessel，節點的 IP 可能另外被擋。

主機設定好之後，在入口網站後端的 `/etc/vessel/api.env` 加上 `VESSEL_STUN=<主機名稱或 IP>:443`，重新啟動後端。`/api/network` 會回傳這個值，前端才會顯示 UDP 的檢測，沒有設定時這一項不出現。

## 執行

用 Docker：

```bash
docker build -t vessel-stun stun/
docker run -d --name vessel-stun --restart unless-stopped -p 443:3478/udp vessel-stun
```

容器裡以 `nobody` 執行，聽 3478，再對應到主機的 UDP 443。不用 Docker 時，把 `stun.py` 放到 `/opt/vessel-stun/`，用 `vessel-stun.service` 交給 systemd，它只給程式綁定 443 埠的權限。

在本機試的時候用高位的埠，不需要 root：

```bash
python3 stun/stun.py --port 34780
python3 -m unittest discover -s stun
```

## 濫用

STUN 的回應比請求大一些（IPv4 是 32 bytes，最小的請求是 20 bytes），偽造來源位址的反射攻擊效果有限。格式不對的封包、RFC 3489 的舊式請求與其他 STUN 訊息都不回應。需要限速時，在主機的防火牆設定，伺服器本身不保存任何位址。
