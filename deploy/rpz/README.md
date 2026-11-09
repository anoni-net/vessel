# rpz

節點訂閱 DNSBunker CTI 名單的主伺服器，架設在維護者的主機上（NSD）。節點的 unbound 透過 Tailscale 只取得變動的部分，更新時解析器暫停約 1.5 秒，整份重新載入要 12 秒。unbound 不能提供區域傳送，所以主伺服器用 NSD。

| 檔案 | 內容 |
|---|---|
| `Dockerfile` | NSD 的映像 |
| `nsd.conf.example` | 設定檔範本，複製成 `nsd.conf` 後填入 Tailscale 位址，每個節點一行 `provide-xfr` |
| `build-cti.sh` | 下載名單、清理、產生區域檔、讓 NSD 重新讀取。清理與上下限沿用 `node/update-lists.sh` |

NSD 只處理名單，看不到使用者的查詢。節點連線的 IP 不進 repo，只放在主機的 `nsd.conf` 與節點的 `node.env`。

## 安裝

```bash
sudo mkdir -p /srv/vessel-rpz/zones/state && sudo chown -R ubuntu:ubuntu /srv/vessel-rpz
# 複製 Dockerfile、build-cti.sh、nsd.conf，以及 node/update-lists.sh 與 node/exclude.txt
cd /srv/vessel-rpz && docker build -t vessel-rpz-nsd:alpine3.24 . && ./build-cti.sh
docker run -d --name vessel-rpz-nsd --restart unless-stopped --network host --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges --read-only --tmpfs /tmp:uid=1000,gid=1000 --memory 1200m --pids-limit 32 \
  --log-opt max-size=5m --log-opt max-file=2 -v /srv/vessel-rpz/zones:/z \
  -v /srv/vessel-rpz/nsd.conf:/etc/nsd/nsd.conf:ro vessel-rpz-nsd:alpine3.24 nsd -d -c /etc/nsd/nsd.conf
```

防火牆只放行節點的 Tailscale 位址，每個節點一條 `ufw allow in on tailscale0 from <節點> to <本機> port 5300`。節點在 UTC 04:37、10:37、16:37、22:37 取得更新，名單要在 UTC 04:30、10:30、16:30、22:30 產生。cron 用主機的時區，主機是台灣時間時寫成：

```cron
30 0,6,12,18 * * * VESSEL_NTFY=http://<ntfy 主機>/<topic> /srv/vessel-rpz/build-cti.sh >> /srv/vessel-rpz/build.log 2>&1
```

設定 `VESSEL_NTFY` 之後，下載失敗、筆數超出上下限或 NSD 無法重新讀取時推播到 ntfy，跟 `deploy/health_warn.py` 一樣只在狀態改變時推一次，恢復時再推一次。超過上限時名單會停止更新，節點繼續使用上一份，收到告警要決定調高 `node/update-lists.sh` 的 `MAX_LINES`，或排除部分名單。每次的筆數記在 `build.log`。

新增節點時，`nsd.conf` 加一行 `provide-xfr`，再執行 `docker exec vessel-rpz-nsd nsd-control -c /etc/nsd/nsd.conf reconfig`。

改了 `node/update-lists.sh` 或 `node/exclude.txt` 之後，要同步複製到主機，下一次產生名單才會生效。
