# 主機端的 SBOM

產生主機上正在執行的容器映像的 SBOM（軟體物料清單，列出映像裡每個套件與版本）。CI 的 `.github/workflows/sbom.yml` 也會從 repo 建置映像產生 SBOM，但 `node/Dockerfile` 與 `api/Dockerfile` 在建置時才向發行版安裝套件，主機在其他日子重建的映像可能裝了更新的版本。有新的漏洞公布時，要確認某台主機實際裝了哪個版本，看這裡產生的檔案。

```bash
tools/host-sbom/run.sh <SSH 別名>                    # 節點，預設讀 vessel-node 容器
tools/host-sbom/run.sh <SSH 別名> <容器> <容器>...    # 後端的主機，容器名稱用 docker ps 查
```

重建映像之後執行一次。`node/deploy.sh` 在需要重建時會一起提醒。

## 做法

腳本經 SSH 在主機上執行 `docker inspect` 取得容器實際使用的映像，再用 `docker save` 把映像傳回維護者的電腦，由固定版本的 Syft 容器產生 CycloneDX 格式的 SBOM，只列套件，不列檔案。主機上不安裝任何東西，需要的權限跟 `node/drift-check.sh` 相同（SSH 與 sudo）。

檔案存在 `$VESSEL_SBOM_DIR`（預設 `~/vessel-sbom`），檔名是主機別名、容器、日期與映像 ID 的前 12 碼，權限是只有自己能讀取。SBOM 列出各台主機確切的套件版本，所以不進 repo，也不公開。

比對漏洞資料庫：

```bash
docker run --rm -v ~/vessel-sbom:/s anchore/grype sbom:/s/<檔名> --only-fixed
```

## 測試

`tools/host-sbom/test.sh` 在本機起一個容器，用一個不經 SSH、直接在本機執行指令的 `ssh` 代替主機，確認產生的檔案是 CycloneDX、列出 Alpine 的套件、不含檔案清單，而且權限是 600。CI 的 `node` job 會執行它。
