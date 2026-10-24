export const insecureTransportMessage =
  "当前连接未加密，请使用 HTTPS 地址访问工作台后再登录或设置密码。";

export function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function allowsCredentials(
  location: { protocol: string },
  requireHttps = false,
) {
  return (
    location.protocol === "https:" ||
    (location.protocol === "http:" && !requireHttps)
  );
}
