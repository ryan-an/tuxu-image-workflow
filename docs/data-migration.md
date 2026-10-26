# 图序数据备份与迁移指南

本项目的正式服务端数据由两部分组成：

```text
data/   # SQLite、WAL/SHM、图片素材、日志、HTTPS 证书
.env    # APP_PASSWORD、CREDENTIAL_SECRET 和运行配置
```

迁移时必须同时保留这两部分。`CREDENTIAL_SECRET` 是解密已保存平台 API Key 的主密钥，丢失或更换后，数据库仍在，但旧 API Key 无法解密。

## Windows 便携版升级

先在启动窗口按 Ctrl+C 停止旧程序，然后复制完整的 `data/` 目录和 `.env`。将新版程序解压到新的目录，再把这两个项目复制到新版程序目录，最后双击启动脚本。

不要只复制 `workspace.sqlite`。SQLite 运行时可能还有 `workspace.sqlite-wal` 和 `workspace.sqlite-shm`，图片也保存在 `data/assets/` 中。

便携版固定要求以下路径位于程序目录旁：

```dotenv
DATABASE_PATH=./data/workspace.sqlite
ASSET_DIRECTORY=./data/assets
```

如果旧 `.env` 中写了其他路径，先把数据复制到新版目录的 `data/`，再将这两个配置改为上面的默认值；其他密码、密钥和服务配置保持不变。

## Docker 迁移到 Windows 便携版

Docker 部署把 `/app/data` 放在 Compose 命名卷中，宿主机项目目录通常没有可直接复制的 `data/`。先进入 Docker 部署目录并停止应用：

```bash
docker compose -f compose.yaml stop app
docker volume ls
```

确认实际卷名，默认通常是 `tuxu_workspace`。将命名卷导出到部署目录：

```bash
docker run --rm \
  -v tuxu_workspace:/source \
  -v "$PWD:/backup" \
  alpine sh -c 'cd /source && tar czf /backup/tuxu-data.tar.gz .'
cp .env ./docker-backup.env
```

同时复制 Docker 部署目录中的 `.env`。然后在 Windows 便携版程序目录中解压数据包：

```powershell
New-Item -ItemType Directory -Force .\data | Out-Null
tar -xzf .\tuxu-data.tar.gz -C .\data
Copy-Item .\docker-backup.env .\.env
```

如果 `.env` 中存在 `DATABASE_PATH=/app/data/workspace.sqlite` 或 `ASSET_DIRECTORY=/app/data/assets`，改成便携版路径：

```dotenv
DATABASE_PATH=./data/workspace.sqlite
ASSET_DIRECTORY=./data/assets
```

不要修改 `CREDENTIAL_SECRET`。启动后使用原 Docker 管理员账号和密码登录，原工作区、产品、图片、任务、对话、表格和 API Key 会继续使用。

## 恢复备份

停止程序后，将备份的 `data/` 和 `.env` 放回程序目录，再启动。恢复时不要把运行中的数据库文件覆盖到旧文件上；如果目标目录已有数据，先完整改名保存，确认备份有效后再处理旧目录。

## 版本升级

新版本启动时会自动执行追加数据库迁移。升级前先备份 `data/` 和 `.env`；升级后如果需要回退，应恢复升级前的两者，而不是只替换程序文件。不要执行 `docker compose down -v`，它会删除 Docker 命名卷。

## 不在服务端迁移范围内的内容

浏览器中尚未保存的编辑草稿、浏览器 IndexedDB 兼容数据和浏览器缓存不在 `data/` 与 `.env` 中。正式保存的账号、工作区、素材、结果、任务、对话、表格和平台凭据都在服务端数据中。
