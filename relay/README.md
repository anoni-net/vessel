# Vessel 的入口

入口是一台把 UDP 封包原封不動轉送到 Vessel 節點的主機。使用者的裝置先連到入口，入口把封包轉給節點，節點再連上網路。通道從裝置一路加密到節點，入口不會解開，所以看得到誰連進來、流量多少，看不到連往哪裡與內容。

這個目錄給營運入口的團體使用：`vessel-relay` 是設定入口的腳本，`NORMS.md` 是營運入口要遵守的規範，合作之前請先讀過規範。

## 需求

- 一台有公開 IPv4 位址的 Linux 主機，有 root 權限。Ubuntu 24.04 測試過，其他有 nftables 與 systemd 的發行版也可以
- 已經安裝 nftables（`apt install nftables`）
- 主機商的防火牆或安全群組開放 anoni.net 給你的 UDP 埠
- 頻寬與流量依約定的使用人數估算，入口的 CPU 與記憶體用量很小

## 安裝

anoni.net 會給你每條路線的兩個值：入口上的埠，以及要轉送到的節點位址。寫進 `/etc/vessel-relay.conf`，一條路線一行：

```text
# 入口上的埠  節點的位址:埠
51001  <節點的 IP>:443
51002  <另一個節點的 IP>:443
```

節點的 IP 不公開，請不要放進公開的設定或截圖。接著安裝：

```bash
curl -fsSLO https://raw.githubusercontent.com/anoni-net/vessel/main/relay/vessel-relay
less vessel-relay                 # 先讀過腳本
sudo bash vessel-relay install
```

`install` 會做這幾件事，不會動到主機原本的其他防火牆規則：

- 把腳本放到 `/usr/local/sbin/vessel-relay`
- 開啟 IPv4 轉送（`/etc/sysctl.d/99-vessel-relay.conf`）
- 依設定檔建立自己的 nftables 表 `inet vessel_relay`
- 建立開機時套用的 systemd 服務 `vessel-relay.service`

## 日常操作

```bash
sudo vessel-relay status    # 每條路線開始的連線數、轉送的封包與流量
sudo vessel-relay apply     # 改了設定檔之後重新套用
sudo vessel-relay print     # 只印出會套用的規則，不改任何東西
sudo vessel-relay remove    # 移除表、開機服務與轉送的設定，保留設定檔
```

`status` 只有數字，不會印出任何使用者的 IP。重新套用時整個表一次替換，設定檔有錯就不會套用，原本的轉送照常運作。

## 不記錄的做法

- 規則只有轉送與計數，沒有任何記錄封包的規則。主機上其他防火牆（例如 ufw）的記錄功能請關閉，或至少排除這些埠
- 雲端平台的連線紀錄（例如 VPC flow log）請關閉
- 轉送需要連線追蹤（conntrack）：連線期間，核心的記憶體裡會有使用者的 IP 與埠，才能把節點的回應送回去。連線結束後，這筆資料在 UDP 的逾時（約 30 秒到 2 分鐘）之後消失，不寫進硬碟。`conntrack -L` 之類的指令可以列出這些資料，營運者不應匯出或保存
- 節點看到的來源都是入口的位址，看不到使用者的 IP

## 主機已經有防火牆時

`vessel_relay` 表只放行自己的流量，主機上其他的表或 iptables 規則如果丟棄轉送的封包，仍然會擋下：

- Docker 會把 iptables 的 `FORWARD` 預設改成丟棄，要在 `DOCKER-USER` 放行，例如 `iptables -I DOCKER-USER -p udp -d <節點的 IP> --dport 443 -j ACCEPT` 與回程的 `iptables -I DOCKER-USER -p udp -s <節點的 IP> --sport 443 -j ACCEPT`
- ufw 預設不允許轉送，可以用 `ufw route allow proto udp to <節點的 IP> port 443`

設定之後，請 anoni.net 用測試的裝置連一次，`status` 的計數有增加就代表轉送正常。

## 測試

`test/netns-test.sh` 用 network namespace 模擬裝置、入口與節點三台主機，實際送 UDP 封包，確認轉送、回程、第二條路線、錯誤的設定與移除。需要 root：

```bash
sudo bash relay/test/netns-test.sh
```
