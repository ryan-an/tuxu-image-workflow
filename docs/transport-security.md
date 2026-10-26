# 登录与 HTTPS

密码在数据库中使用随机盐和 scrypt 保存。HTTP 与 HTTPS 均可部署，默认不强制 HTTPS；HTTP 本身不加密网络传输。启用 HTTPS/TLS 后，可同时保护密码、邀请令牌、API Key、资料和登录 Cookie。开发者工具显示的是浏览器加密前的请求正文，不能据此判断网络上是否明文传输。前端固定哈希可以被直接重放，不能替代 TLS。

## 本机和网络访问

`.env` 中的开关默认关闭：

```dotenv
REQUIRE_HTTPS=false
```

关闭时，本机、局域网、Docker 和公网 IP 均允许 HTTP，登录、邀请、改密和业务接口照常工作，不要求证书，不自动跳转。普通 Node 服务若需接收其他设备的连接，可设置 `HOST=0.0.0.0`；源码 Compose 与本地 Docker 部署脚本默认只绑定本机 3001；公网端口和自动域名代理按 [Docker 部署](docker-deployment.md) 配置。

以后需要强制 HTTPS 时，先配好证书或 HTTPS 代理，再设置 `REQUIRE_HTTPS=true` 并重启服务，无需重新构建前端。开启后所有 HTTP 业务请求（含本机）在解析请求体、校验密码和创建会话前被拒绝，返回 426；若同时配置 `PUBLIC_ORIGIN`，GET/HEAD 导航跳转到该固定 HTTPS 入口，含密码的 POST 不重定向。`PUBLIC_ORIGIN` 单独存在不会开启拦截。

前端每次认证请求先读取公开的 `/api/auth/transport-policy`，再按同一个运行时开关判断是否允许提交。策略接口不发送 Cookie，也不缓存；无法读取有效策略时显示错误并允许重试。`/health` 与只返回开关布尔值的策略接口允许 HTTP。开启强制模式时，伪造 Host 或不可信的 `X-Forwarded-Proto` 不能绕过检查。

HTTP 页面创建产品、生成任务、咨询和模板统一使用 `shared/model.js` 的 `uid()`：支持时采用原生 UUID，否则使用 HTTP 可用的随机字节生成 UUID，避免依赖仅限安全上下文的接口。API 资产缩略图由服务端生成；旧 data URI 图片在缺少浏览器摘要接口时仍可压缩显示，不复用无法验证来源的旧缩略图。浏览器接口限制见 [MDN getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)。

## 没有域名时启用本地/IP 证书

需要 OpenSSL；Windows 可使用 Git for Windows 自带的程序，工具会自动查找，也可设置 `OPENSSL_PATH`。

```powershell
npm run setup:https
npm run build
npm start
```

工具为 localhost、回环 IP 和本机现有 IPv4 地址生成本地 CA 及签名证书，写入 `data/tls/` 和 `.env`；不修改账号、数据库、主密钥或系统信任库。访问地址改为 `https://127.0.0.1:3001`。服务证书有效期一年；已有 TLS 配置或密钥文件不会被覆盖。

在每台访问设备上核对终端输出的 CA SHA-256 指纹，导入 `data/tls/local-ca.pem` 为受信任的根证书。Windows 当前用户可手动执行：

```powershell
certutil -user -addstore Root .\data\tls\local-ca.pem
```

只分发 `local-ca.pem` 公共证书，私钥文件留在服务端。浏览器信任证书后再登录，不使用忽略证书错误的启动参数。若用于局域网，还需将 `.env` 的 `HOST` 设置为实际监听地址；生成工具不会主动开放监听或防火墙。IP 改变后需要签发包含新 IP 的服务证书。

也可传入额外主机名或 IP：`npm run setup:https -- 192.168.1.10`。已有可信证书时直接配置下表中的证书与私钥路径，不运行生成工具。

| 配置                            | 作用                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| `REQUIRE_HTTPS`                 | 是否强制 HTTPS；默认 `false`，改为 `true` 后重启生效，无需重建前端 |
| `HOST`、`PORT`                  | Node 服务监听地址与端口；网络共享通常使用 `HOST=0.0.0.0`           |
| `TLS_CERT_FILE`、`TLS_KEY_FILE` | 服务端直接提供 HTTPS，必须同时配置，最低 TLS 1.2                   |
| `TLS_CA_FILE`                   | Vite 开发代理验证本地 HTTPS 服务所需的 CA；生成工具自动填写        |
| `TRUSTED_PROXIES`               | 明确列出的反向代理 IP/CIDR，逗号分隔；默认不信任转发头             |
| `PUBLIC_ORIGIN`                 | 可选的 HTTPS 站点原点，例如 `https://images.example.com`，不含路径 |

配置证书后，Vite 开发服务器及其到 API 的代理都使用 HTTPS，并验证上游证书。Docker 若直接使用应用证书，需要自行把 `data/tls/` 挂载为只读目录并传入证书环境变量，服务账号需能读取私钥。证书配置与强制开关独立：直接配置 TLS 证书会把监听器切换为 HTTPS；只有 `REQUIRE_HTTPS=true` 才会启用 HTTP 拒绝和跳转策略。

## 已有 HTTPS 反向代理

代理必须覆盖客户端传入的 `X-Forwarded-Proto`，HTTPS 请求写为 `https`，保留站点 Host，后端仅向该代理开放。将实际代理 IP 加入 `TRUSTED_PROXIES`，设置 `PUBLIC_ORIGIN` 为真实 HTTPS 地址。不要把所有客户端或整个非受控网络设为可信代理。若通过反向代理终止 TLS，可留空应用的 `TLS_CERT_FILE` / `TLS_KEY_FILE`。

HTTPS 登录 Cookie 带 `Secure; HttpOnly; SameSite=Strict`；HTTP Cookie 保留 HttpOnly 与 SameSite=Strict，正常支持 HTTP 会话。会话检查会升级原 HTTP Cookie 的 Secure 属性，数据库的原过期时间不延长。仅强制模式对非本机 HTTPS 响应启用 HSTS；关闭时 HTTPS 返回 `max-age=0`，避免继续强制浏览器升级。已有 HSTS 缓存的浏览器需要通过 HTTPS 访问一次才能收到清除策略。写请求仍校验 Origin 的协议和主机。登录、邀请激活与改密共用传输规则；日志不包含密码、请求正文或会话令牌，启动终端也不再输出登录密码。

实现边界：`shared/transport-security.ts` 放客户端可复用的地址规则；`server/production/transport-security.ts` 负责证书配置、可信代理和请求拦截；认证业务仍由 `authentication.ts`、`accounts.ts` 与 `invitations.ts` 负责。证书工具只负责离线生成与配置。

验证包含关闭时四种 HTTP 来源的登录/写入、开启后的 HTTP 拦截、运行时前端策略、代理伪造、同源协议降级、Secure Cookie 升级、真实受信任 TLS 连接、无信任 CA 的连接拒绝，以及浏览器中 HTTP/HTTPS 两套登录、邀请和改密流程。测试使用临时证书，不安装到系统信任库。

参考：[MDN TLS](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Transport_Layer_Security)、[Fastify HTTPS 与可信代理](https://fastify.dev/docs/latest/Reference/Server/)。
