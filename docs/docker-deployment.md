# 云服务器 Docker 部署

数据迁移、备份和从 Docker 命名卷迁移到 Windows 便携版的完整步骤见 [数据备份与迁移指南](data-migration.md)。

在开发电脑运行以下 JS 脚本。默认方式不需要本机 Docker、WSL 或虚拟机平台；电脑只需 Node.js 24、已安装的项目依赖、tar、SSH 和 SCP（现代 Windows 自带 tar，可选功能中提供 OpenSSH 客户端）。服务器只需要 Linux、Docker 和 Docker Compose，不需要 Node.js 或业务源码。SSH 用户需要有 Docker 和部署目录的使用权限，例如 root。首次连接请核对 SSH 主机指纹；密码或密钥由 SSH 自行处理，脚本不保存 SSH 凭据。

## 打包

```powershell
npm run docker:pack
```

默认在本机运行 `npm run build` 编译，然后输出到 `artifacts/docker/tuxu/`，面向 `linux/amd64` 服务器：

- `tuxu-app.tar.gz`：前端 `dist`、后端 `build-server`、依赖清单和 `Dockerfile.runtime`，不含业务源码、source map、本机 node_modules、密钥或个人数据。
- `configure.mjs`：在服务器容器内生成启动配置的 JS 脚本。
- `manifest.json`：镜像标签和目标平台。

上传后，服务器 Docker 使用编译产物组装镜像，并通过 `npm ci --omit=dev` 安装 Linux 运行依赖，避免复制 Windows 原生模块。依赖构建阶段会安装 Python、make 和 C++ 编译器，支持 `better-sqlite3` 无法下载预编译包时在容器内编译；编译工具不进入最终运行镜像。服务器需能访问 Docker 镜像仓库、Debian 软件源和 npm registry。ARM64 服务器需指定对应平台：

```powershell
npm run docker:pack -- --platform linux/arm64
```

可用 `--tag tuxu-image:1.0` 指定镜像标签，`--out 目录` 指定输出目录。打包会覆盖该输出目录中的部署包文件。

如果以后本机安装了 Docker，也保留完整镜像模式：`npm run docker:image`。该模式在本机构建并导出 `tuxu-image.tar`，服务器直接加载。两种包都使用下面同一条部署命令；脚本根据 manifest 自动识别。完整镜像模式下，本机 Docker 使用 Linux 容器。

## 服务器手动部署

不使用自动 SSH 部署脚本时，把 `artifacts/docker/tuxu/` 中的以下三个文件上传到服务器的 `/opt/tuxu/`：

```text
tuxu-app.tar.gz
configure.mjs
manifest.json
```

服务器上执行：

```bash
cd /opt/tuxu
```

如果 Debian 软件源访问较慢，可以只修改这次 Docker 构建使用的临时 Dockerfile，不会修改服务器系统：

```bash
mkdir -p build-mirror
tar -xzf tuxu-app.tar.gz -C build-mirror
sed -i 's@http://deb.debian.org@http://mirrors.tuna.tsinghua.edu.cn@g' build-mirror/Dockerfile.runtime
docker build --progress=plain --platform linux/amd64 \
  -t tuxu-image:0.1.0 \
  -f build-mirror/Dockerfile.runtime \
  build-mirror
```

新版运行包已经把清华 Debian 源写入 `Dockerfile.runtime`，因此重新上传新版包后可以直接构建：

```bash
docker build --progress=plain --platform linux/amd64 \
  -t tuxu-image:0.1.0 \
  -f Dockerfile.runtime \
  - < tuxu-app.tar.gz
```

构建成功后，首次生成 `.env`、`compose.yaml` 和端口配置：

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --entrypoint node \
  -v "$PWD:/deploy" \
  tuxu-image:0.1.0 \
  /deploy/configure.mjs \
  --image tuxu-image:0.1.0
```

默认只绑定服务器本机的 3001。如果服务器 3001 已被其他 Node 服务占用，可以把 `compose.yaml` 的映射改成任意空闲公网端口，例如：

```yaml
ports:
  - "8088:3001"
```

容器内部仍然使用 3001；服务器上其他程序占用 3001 不影响它。改完后启动：

```bash
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps
curl http://127.0.0.1:8088/health
```

如果映射为 `80:3001`，访问 `http://服务器公网IP`；如果映射为 `8088:3001`，访问 `http://服务器公网IP:8088`。同时在云安全组和服务器防火墙放行对应端口。不要把同一个服务器端口映射给两个容器。

登录用户名固定为 `admin`。`.env` 是隐藏文件，用下面命令查看随机生成的密码：

```bash
cd /opt/tuxu
ls -la
grep '^APP_PASSWORD=' .env
```

`CREDENTIAL_SECRET` 是加密主密钥，用于解密保存的 API Key；不要修改或删除。若要改登录密码，编辑 `.env` 中的 `APP_PASSWORD` 后执行：

```bash
docker compose -f compose.yaml up -d --force-recreate
```

这次密码曾在终端或截图中显示过，部署后应立即改成新的私密密码。

## 部署

先把域名 A 记录解析到服务器，并在云安全组和服务器防火墙放行 TCP 80、443。自动 HTTPS 需要这两个端口未被其他程序占用。

```powershell
npm run docker:deploy -- --host root@服务器IP --domain tuxu.example.com
```

替换 SSH 地址和域名。脚本自动检查 Docker、创建 `/opt/tuxu`、通过 SCP 上传部署包、在服务器组装或加载镜像、生成配置、启动服务并检查应用健康状态。域名模式自动启动 Caddy 管理 HTTPS，支持豆包流式回复。首次部署随机生成登录密码和加密密钥，保存在服务器 `/opt/tuxu/.env`；登录用户名为 `admin`。脚本不在本机终端打印密钥。

可以通过 `--ssh-port 2222` 指定 SSH 端口，`--dir /opt/tuxu` 指定服务器部署目录，`--bundle 本机部署包目录` 指定打包结果，`--project tuxu` 指定 Compose 项目名。更新时保持部署目录和项目名一致。

已有宝塔、Nginx 等 HTTPS 反向代理时，不传 `--domain`，将现有网站代理到服务器 `http://127.0.0.1:3001`；保留 Host 请求头，关闭代理缓冲并延长读取超时。现有 `compose.yaml` 不会被脚本接管，请选择新的部署目录并另行迁移已有数据。

没有域名时可先启动应用：

```powershell
npm run docker:deploy -- --host root@服务器IP
ssh -N -L 3001:127.0.0.1:3001 root@服务器IP
```

保持 SSH 隧道窗口开启，浏览器访问 `http://127.0.0.1:3001`。3001 只绑定服务器回环地址，无需开放公网端口。

## 更新与数据

从 v0.2.0 起，每次成功生成新部署包都会保留版本号、安装包和图文更新日志。默认第一次使用 v0.2.0，后续新包自动递增修订号；重复部署同一个包不会增加版本号。用户可通过 `/updates/` 或账号菜单查看说明，历史安装包保存在 `artifacts/docker/releases/`。填写下一版说明、重新拍图和选择历史包的方法见 [版本管理](releases/README.md)。

自动域名模式继续使用 Caddy；脚本为代理保留独立网络与固定地址，并传入新版登录校验需要的可信代理和站点地址。更新时保留 `deployment.json`、`.env` 和原数据卷。已有外部代理时，在服务器 `.env` 中填写实际代理的 `TRUSTED_PROXIES` 和 `PUBLIC_ORIGIN`。

已执行旧版表格导入 `008.sql` 的数据库会在升级时保留其校验和及执行记录，改记为 `014.sql`，随后补齐账号和工作区迁移；表格待确认记录保留，不要手动删除迁移记录。

修改后重新运行 `docker:pack`，再用相同的 `docker:deploy` 命令部署。脚本保留服务器已有 `.env`、域名和数据卷；不会重新生成旧加密密钥。可再次传入 `--domain` 更换域名。若配置过自动 HTTPS，更新时省略 `--domain` 也会保留它。

应用健康检查通过代表容器内 API 与数据库可用，域名解析、证书申请和公网连通仍需通过浏览器确认。启动失败时，在服务器部署目录执行 `docker compose -f compose.yaml logs --tail=100 app`；证书问题查看 `docker compose -f compose.yaml logs --tail=100 caddy`。

常用检查命令：

```bash
docker ps
docker compose -f compose.yaml logs --tail=100 app
docker image ls tuxu-image
docker system df
df -h /
```

数据保存在 Compose 项目的 `workspace` 命名卷，默认名为 `tuxu_workspace`，所以 Docker 部署目录通常看不到 `data/` 文件夹。完整备份应先停止 app，再导出整个数据卷并复制部署目录中的 `.env`，完成后启动 app。不要执行 `docker compose down -v`，它会删除数据卷。

从 Docker 迁移到 Windows 便携版时，在 Docker 服务器部署目录执行（先确认 Compose 项目已停止）：

```bash
docker compose -f compose.yaml stop app
docker run --rm -v tuxu_workspace:/source -v "$PWD:/backup" alpine sh -c 'cd /source && tar czf /backup/tuxu-data.tar.gz .'
cp .env /安全备份位置/tuxu.env
```

将 `tuxu-data.tar.gz` 解压到便携版程序目录的 `data/`，并把 Docker 部署目录的 `.env` 复制为便携版目录的 `.env`。Windows PowerShell 可在已安装 Docker 的机器上执行：

```powershell
docker compose -f compose.yaml stop app
docker run --rm -v tuxu_workspace:/source -v "${PWD}:/backup" alpine sh -c "cd /source && tar czf /backup/tuxu-data.tar.gz ."
```

如果 Compose 项目名不是 `tuxu`，先用 `docker volume ls` 查实际卷名；卷名通常是 `<项目名>_workspace`。不要只复制宿主机上的 `.env`，也不要把运行中的 `workspace.sqlite` 单独复制，必须包含卷内的 `assets/` 及 SQLite 的 WAL/SHM 文件。Caddy 的证书卷 `caddy_data` 和 `caddy_config` 只用于 Docker 反向代理，迁移到便携版直连模式不需要。
