# 图序 · 批量生图工作流

个人本机使用：React / TypeScript 前端，Fastify API 与后台任务队列运行在一个 Node.js 进程，SQLite 保存工作区和任务，图片保存在本地目录。无需安装 PostgreSQL 或 Docker。

## 本机启动

需要 Node.js 24。首次安装和构建：

```powershell
npm install
npm run build
npm start
```

已经构建后，双击 `启动图序.cmd` 即可启动。打开 http://127.0.0.1:3001，用户名 `admin`。首次启动自动生成 `.env`、登录密码和加密主密钥，终端显示登录密码；后续启动保留配置。平台 API Key 在页面的“密钥设置”填写，保存不会自动发起生成。

## 数据与恢复

- `data/workspace.sqlite`：产品、提示词、任务、结果记录和加密后的平台密钥。
- `data/assets/`：上传素材与生成图片。
- `.env`：端口、登录密码与加密主密钥。请保留此文件，否则无法解密旧平台密钥。

SQLite 使用 WAL、事务和外键约束。生图请求支持配置并发；数据库写入由短事务串行完成。关闭网页后后台继续执行，关闭服务后重新启动可以恢复已持久化任务。已获得平台任务 ID 的任务继续查询原 ID；提交中断且无法判断平台是否受理时，需要在队列里核对，避免重复付费。

完整备份：停止应用，再复制整个 `data` 目录和 `.env`。运行中不能只复制主数据库文件而忽略 WAL。页面的工作流备份包含图片，可导入新的空工作区，不包含平台密钥。未保存的编辑草稿请先保存。

首次打开空服务端工作区，会读取当前浏览器里的旧 v2 工作区并导入；旧 IndexedDB 数据保留。未完成旧任务停止，检查后可恢复。新用户不会自动创建演示产品。

## 开发与验证

后台日志在启动终端实时显示，同时追加到 `data/logs/server.log`。在 PowerShell 中运行 `Get-Content .\data\logs\server.log -Tail 50 -Wait` 可持续查看。任务错误记录包含任务 ID、阶段、模型、耗时和底层网络错误码，不记录 API Key、请求正文或图片内容。页面“执行队列”的明细也可查看每条任务错误。

运行 `npm run dev:api`，另一个终端运行 `npm run dev`，前端 5173 的 API 请求转发到 3001。后端修改后重新启动。正式运行使用 `npm run build` 后的 `npm start`，同一个进程提供页面、API 和后台队列。

```powershell
npm test
npm run build
```

测试使用隔离的真实 SQLite 文件和模拟平台，验证事务、并发领取、任务恢复、文件重开、图片与凭据持久化，不修改个人数据或调用付费接口。

浏览器回归在构建并运行上述测试后执行：

```powershell
$env:PLAYWRIGHT_MODULE = '你的 Playwright 模块目录'
$env:CHROME_PATH = '你的 chrome.exe 路径'
node --test build-test/server/production/browser.test.js
```

覆盖登录、编辑草稿、提示词保存、后台生成后重开页面、选图、ZIP、表格复用和工作流备份。真实生成需要配置自己的 Grsai API Key。

## 可选 Docker

先运行 `npm run setup` 生成配置，再运行 `docker compose up --build -d`。只有一个应用容器和一个数据卷，访问地址相同。外网访问需要 HTTPS 反向代理。

模块职责见 [架构文档](docs/architecture.md)，前端维护见 [前端架构](docs/frontend.md)。旧原型记录见 [原型记录](docs/legacy-prototype.md)。`npm run dev:demo` 仅用于旧原型兼容验证。
