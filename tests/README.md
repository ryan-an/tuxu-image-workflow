# 测试目录

测试与业务源码分开存放；新增测试和夹具统一放在本目录，禁止放入 `src/`、`server/`、`shared/` 或项目根目录。

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

浏览器回归需要先构建前端，提供本机 Playwright 模块与 Chrome 路径：

```powershell
npm run build
$env:PLAYWRIGHT_MODULE = '你的 Playwright 模块目录'
$env:CHROME_PATH = '你的 chrome.exe 路径'
npm run test:e2e
```

`scripts/run-tests.mjs` 按源文件发现测试，执行 `build-test/tests/` 中的编译结果，避免已删除测试的旧产物被误执行。测试构建包含测试目录，生产构建排除测试和夹具。公共夹具在系统临时目录创建数据库与素材，关闭后清理，不读取个人数据库或调用付费平台。

截图、下载与备份通过 `support/artifacts.cjs` 的 `artifactPath` 写入 `artifacts/tests/`，不要向项目根目录或业务目录写入测试产物。显式指定截图环境变量路径时沿用指定位置。原有根目录截图与日志已分别归档至 `artifacts/screenshots/` 和 `artifacts/logs/`。

`legacy/verify-*.cjs` 保留原型验证用途，需要运行对应演示页面；其中部分脚本仍使用开发机的 Playwright/Chrome 路径，运行前需按本机环境调整。当前生产页面回归使用 `e2e/`。
