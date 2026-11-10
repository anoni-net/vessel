# rpz

節點六份封鎖名單的主伺服器，架設在維護者的主機上（NSD）。節點不下載也不轉換名單，unbound 透過 Tailscale 只取得變動的部分，更新時解析器暫停約 1.5 秒，整份重新載入要 12 秒。unbound 不能提供區域傳送，所以主伺服器用 NSD。

這台主機離線時，節點繼續用手上的名單，解析不受影響，只是名單不會更新。

| 檔案 | 內容 |
|---|---|
| `Dockerfile` | NSD 的映像 |
| `nsd.conf.example` | 設定檔範本，複製成 `nsd.conf` 後填入 Tailscale 位址，每個節點一行 `provide-xfr` |
| `build-zones.sh` | 下載六份名單、清理、去重複、產生區域檔、讓 NSD 重新讀取有變動的名單 |
| `lists.sh` | 每份名單的來源、清理方式與筆數上下限 |
| `dedupe.py` | 後面的名單拿掉前面已經擋下的條目。順序要跟 `node/unbound/rpz-zones.conf.example` 相同 |

`build-zones.sh` 另外下載 Public Suffix List，把私有區段存成 `platforms.txt`，DNSBunker CTI 只保留這些託管平台底下的名稱。下載失敗或內容太短時沿用上一份。

NSD 只處理名單，看不到使用者的查詢。節點連線的 IP 不進 repo，只放在主機的 `nsd.conf` 與節點的 `node.env`。

## 安裝

```bash
sudo mkdir -p /srv/vessel-rpz/zones/state && sudo chown -R ubuntu:ubuntu /srv/vessel-rpz
# 複製 Dockerfile、build-zones.sh、lists.sh、dedupe.py、nsd.conf，以及 node/exclude.txt
cd /srv/vessel-rpz && docker build -t vessel-rpz-nsd:alpine3.24 . && ./build-zones.sh
docker run -d --name vessel-rpz-nsd --restart unless-stopped --network host --user 1000:1000 --cap-drop ALL \
  --security-opt no-new-privileges --read-only --tmpfs /tmp:uid=1000,gid=1000 --memory 2g --pids-limit 32 \
  --log-opt max-size=5m --log-opt max-file=2 -v /srv/vessel-rpz/zones:/z \
  -v /srv/vessel-rpz/nsd.conf:/etc/nsd/nsd.conf:ro vessel-rpz-nsd:alpine3.24 nsd -d -c /etc/nsd/nsd.conf
```

防火牆只放行節點的 Tailscale 位址，每個節點一條 `ufw allow in on tailscale0 from <節點> to <本機> port 5300`。節點在 UTC 04:37、10:37、16:37、22:37 取得更新，cron 在 7 分鐘前產生名單（下面的時間是台灣時間）：

```cron
30 0,6,12,18 * * * VESSEL_NTFY=http://<ntfy 主機>/<topic> /srv/vessel-rpz/build-zones.sh >> /srv/vessel-rpz/build.log 2>&1
```

設定 `VESSEL_NTFY` 之後，下載失敗、筆數超出上下限、去重複異常或 NSD 無法重新讀取時推播到 ntfy，只在狀態改變時推一次，恢復時再推一次。

新增節點時，`nsd.conf` 加一行 `provide-xfr`，再執行 `docker exec vessel-rpz-nsd nsd-control -c /etc/nsd/nsd.conf reconfig`。

改了 `build-zones.sh`、`lists.sh`、`dedupe.py` 或 `node/exclude.txt` 之後，要同步複製到主機，下一次產生名單才會生效。
