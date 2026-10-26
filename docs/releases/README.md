# 图文更新日志与部署版本

本次功能版本为 **v0.2.0**。用户访问 `/updates/` 查看当前版本，也可打开 `/updates/v0.2.0.html` 分享固定版本说明。工作台右上角「账号菜单 → 更新日志」显示当前版本并打开该页面。

页面为纯 HTML，截图和样式在本地，不依赖登录、外部网站或 JavaScript。可以把部署包里的整个 `updates/` 文件夹上传到其他静态站点，或保持目录结构在本机打开 `index.html`。截图使用隔离演示资料。

## 生成新部署包

```powershell
npm run docker:pack
```

第一次使用已准备的 v0.2.0。成功打包后，下次新包自动变成 v0.2.1、v0.2.2；构建失败恢复原版本，不消耗号码。同一包重复运行 `docker:deploy` 沿用原版本。

- `artifacts/docker/tuxu/`：最新部署包，原有部署命令继续使用这里。
- `artifacts/docker/releases/v0.2.0/`：保存这个版本的完整部署包、清单和独立图文日志，后续版本不会覆盖它。
- `manifest.json`：记录版本号、日期、镜像标签、更新说明地址和安装包校验值。
- `/version.json`：运行中的应用版本。部署脚本会核对版本，健康检查通过后在服务器 `release-history/` 保存版本清单。

`docker:image` 同样执行版本管理。本地版本锁避免同时打两个包占用相同版本号。版本源文件应随项目一起保存；换电脑打包前先同步这些文件，不要只复制 `package.json`。

## 为下一次更新补充说明

需要先写本次变化时，使用：

```powershell
npm run release -- patch --title "本次更新主题" --note "用普通用户能理解的话说明这次变化"
# 新增一批功能时，也可使用 minor；例如 0.2.x → 0.3.0
npm run release -- minor --title "新一轮功能更新" --note "本次主要更新内容"
```

这会同步 `package.json`、`package-lock.json` 与 `docs/releases/releases.json`，并生成页面；下一次打包使用已准备的版本，不再多加一号。

如果直接打包，没有另外填写更新内容，修订版会明确沿用最近一版完整功能说明，不把旧功能再次描述成「本次新增」。

有新功能截图时，编辑对应版本的 `features`、`highlights`、`fixes` 和 `tips`，移除它的 `notesVersion`，将截图放入 `docs/releases/v版本号/`。目录和文件名在每个功能的 `image` 中配置。保留旧版本条目与图片。

本次五张图可以通过以下流程重新拍摄：先构建应用，按 `tests/README.md` 设置 Playwright 和 Chrome，再运行：

```powershell
npm run release:screenshots
npm run release:notes
```

截图先输出到 `artifacts/tests/release-screenshots/`，成功后才转换成 WebP 保存到版本目录。拍摄使用隔离数据库与演示资料，不连接真实客户工作区、不调用生图平台。新功能页面需要同步维护截图脚本。

提交版本时，检查版本源文件、对应说明与图片，以及根目录 `changelog.md` 一起保存。`public/updates/`、`public/version.json` 是构建产物，构建时从源文件重新生成。

## 重试或选择历史包

```powershell
npm run docker:deploy -- --host root@服务器IP
# 重新部署指定版本，不重新打包、不增加版本号
npm run docker:deploy -- --host root@服务器IP --bundle artifacts/docker/releases/v0.2.0
```

历史程序包不包含历史数据库。若要回退已上线的程序版本，请先确认数据库兼容性并备份数据；不要把「保留历史安装包」当作自动回滚数据库。
