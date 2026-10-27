# 测试目录

测试与业务源码分开存放；新增测试和夹具统一放在本目录，禁止放入 `src/`、`server/`、`shared/` 或项目根目录。

TLS 回归会通过 OpenSSL 在临时目录生成证书（Windows 可自动查找 Git for Windows 的 OpenSSL，或设置 `OPENSSL_PATH`）；不安装证书到系统信任库，也不读取个人证书。浏览器用隔离上下文接受测试 CA，服务端集成测试同时验证证书链可信与不可信的连接。

| 目录                  | 用途                                     |
| --------------------- | ---------------------------------------- |
| `unit/frontend/`      | 前端状态、队列和纯业务逻辑单测           |
| `unit/server/`        | 响应解析、流式提示词和同步策略单测       |
| `integration/server/` | API、真实 SQLite、素材和 Worker 集成测试 |
| `integration/demo/`   | 演示接口兼容测试                         |
| `e2e/`                | 使用隔离数据库及模拟平台的真实浏览器回归 |
| `support/`            | 公共夹具、模拟平台、登录工具             |
| `legacy/`             | 旧原型手工浏览器验证脚本，不加入默认测试 |

从项目根目录执行：

```powershell
npm test                  # 单测与集成测试
npm run test:unit         # 仅单测
npm run test:integration  # 仅集成测试
npm run test:production   # 生产服务端单测与集成测试
npm run test:build        # 编译测试和复制 SQL 迁移
```

保存接口的本机短测使用独立临时数据库及实际回环 HTTP，不读取用户数据或调用平台：

```powershell
npm run test:build
node tests/support/save-load.mjs
# 可选：与指定 Git 版本的保存实现对照，不切换工作目录或修改源码。
node tests/support/save-load.mjs --baseline-ref HEAD
```

固定数据为 100 个产品、501 条历史任务，同一登录会话发出 15 路并发保存，共 30 次请求。报告写入 `artifacts/tests/save-load.json`。对照模式从指定版本读取保存实现，仅替换隔离服务的该方法；其他运行模块使用当前构建，适合比较本次保存链路改动，不代表完整旧版本部署。该测试不包含后台 Worker、SSE、图片上传、反向代理或公网网络，也不等同于客户电脑上 15 个真实用户的长期压力测试。

Windows 便携包完成打包后，可单独验证解压、GUI 子系统、EXE 图标资源、包内原生依赖、从其他目录启动 EXE、网页图标、登录、正常停止和重启后的会话保留（用不显示界面的控制模式驱动同一后台启动器，使用隔离测试目录，不调用模型）：

```powershell
$env:TUXU_WINDOWS_BUNDLE = (Resolve-Path 'artifacts/windows/tuxu-windows-x64-v0.2.1.zip').Path
node --test tests/integration/scripts/windows-portable.test.js
Remove-Item Env:TUXU_WINDOWS_BUNDLE
```

未设置 `TUXU_WINDOWS_BUNDLE` 时，此部署包验证自动跳过。

离线更新 EXE 的验证使用同次打包的 ZIP 和更新工具，确认数据和配置不变、自动备份、运行中拒绝、降级拒绝及替换失败恢复。只操作 `artifacts/tests/` 中的隔离程序目录：

```powershell
$env:TUXU_WINDOWS_BUNDLE = (Resolve-Path 'artifacts/windows/tuxu-windows-x64-v0.2.1.zip').Path
$env:TUXU_WINDOWS_UPDATER = (Resolve-Path 'artifacts/windows/tuxu-update-windows-x64-v0.2.1.exe').Path
node --test tests/integration/scripts/windows-update.test.js
Remove-Item Env:TUXU_WINDOWS_UPDATER
Remove-Item Env:TUXU_WINDOWS_BUNDLE
```

未同时设置两项环境变量时，更新工具验证自动跳过。

Windows 上默认测试还会编译并运行备份保留逻辑，验证成功备份仅保留 2 份、失败备份保留、未完成更新不清理、文件占用提示，以及拒绝跟随备份内的目录链接。测试只操作 `artifacts/tests/backup-retention/` 中的独立数据。完整更新包验证也会检查成功后才清理旧备份，原数据和主密钥保持不变。

Windows 窗口布局可用 `node tests/support/preview-windows-ui.mjs` 检查。脚本按打包配置编译启动器和更新器，使用内嵌界面组件、独立目录及虚拟状态离屏绘制窗口，覆盖首次密码、普通运行、更新进度、成功、失败及 100% / 150% 缩放；检查可见控件没有越出容器，以及关闭隐藏、恢复窗口和显式退出行为。截图与布局信息写入 `artifacts/tests/windows-ui-preview/`，不启动业务服务、不读取个人数据、不显示命令行窗口。完整便携包测试还会用离屏窗口和真实后台验证叉掉后 HTTP 继续访问、恢复窗口及退出后服务停止；测试模式不创建真实托盘图标。

浏览器回归固定最多同时运行 4 个测试文件，避免多个 Chrome 争抢资源引发超时。运行前先构建前端，提供本机 Playwright 模块与 Chrome 路径：

```powershell
npm run build
$env:PLAYWRIGHT_MODULE = '你的 Playwright 模块目录'
$env:CHROME_PATH = '你的 chrome.exe 路径'
npm run test:e2e
npm run test:e2e -- sheet-parser-browser # 只运行相关文件，支持多个文件名片段
```

`scripts/run-tests.mjs` 按源文件发现测试，执行 `build-test/tests/` 中的编译结果，避免已删除测试的旧产物被误执行。测试构建包含测试目录，生产构建排除测试和夹具。公共夹具在系统临时目录创建数据库与素材，关闭后清理，不读取个人数据库或调用付费平台。

浏览器回归固定串行运行，每次只启动一个测试文件的 Chrome；同项目跨终端／聊天的重复启动会被进程锁拒绝，异常退出后的失效锁自动回收。单测／集成测试最多并行两个文件，避免按 CPU 核数同时启动大量浏览器和 SQLite 实例。修改表格功能优先使用文件名片段筛选相关用例，不必每次运行全套。浏览器本身仍采用多进程架构，串行不等于只有一个 chrome.exe；不要用按进程名批量结束 Chrome 的方式清理测试，以免影响日常浏览器。

截图、下载与备份通过 `support/artifacts.cjs` 的 `artifactPath` 写入 `artifacts/tests/`，不要向项目根目录或业务目录写入测试产物。显式指定截图环境变量路径时沿用指定位置。原有根目录截图与日志已分别归档至 `artifacts/screenshots/` 和 `artifacts/logs/`。

`legacy/verify-*.cjs` 保留原型验证用途，需要运行对应演示页面；其中部分脚本仍使用开发机的 Playwright/Chrome 路径，运行前需按本机环境调整。当前生产页面回归使用 `e2e/`。
