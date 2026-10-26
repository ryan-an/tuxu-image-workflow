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

Windows 便携包完成打包后，可单独验证解压、包内原生依赖、启动、登录和重启后的会话保留（使用隔离测试目录，不调用模型）：

```powershell
$env:TUXU_WINDOWS_BUNDLE = (Resolve-Path 'artifacts/windows/tuxu-windows-x64-v0.2.1.zip').Path
node --test tests/integration/scripts/windows-portable.test.js
Remove-Item Env:TUXU_WINDOWS_BUNDLE
```

未设置 `TUXU_WINDOWS_BUNDLE` 时，此部署包验证自动跳过。

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
