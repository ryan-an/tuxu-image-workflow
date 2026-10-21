# 目录与维护约定

- 所有测试统一放在 `tests/`。单测放 `tests/unit/`，集成测试放 `tests/integration/`，浏览器回归放 `tests/e2e/`，公共夹具放 `tests/support/`。禁止在 `src/`、`server/`、`shared/` 或根目录新增测试文件。
- 测试截图、下载与备份使用 `tests/support/artifacts.cjs` 的 `artifactPath`，统一输出到 `artifacts/tests/`。旧原型验证脚本放 `tests/legacy/`。
- 前端按 `ui`（展示）、`application`（用例与状态）、`services`（服务端客户端）、`integrations`（表格、剪贴板、文件与存储适配）、`view-models`（展示数据计算）分工。
- 通用业务规则直接引用 `shared/`，不要在 `src/` 新增无业务内容的转发文件。演示实现放 `src/demo/` 和 `server/demo/`，只在演示模式使用。
- 生产服务采用 `server/production/` 中现有的模块化单体边界；业务代码不得引用测试夹具。数据库迁移只能追加，不能修改已执行迁移。
- 修改后运行 `npm test` 和 `npm run build`；需要浏览器回归时按 `tests/README.md` 配置后运行 `npm run test:e2e`。

详细说明见 `docs/architecture.md`、`docs/frontend.md` 和 `tests/README.md`。
