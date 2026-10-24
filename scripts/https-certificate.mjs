import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, chmod, writeFile, unlink, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isIP } from "node:net";

const execute = promisify(execFile);
export async function findOpenSSL() {
  const candidates = [process.env.OPENSSL_PATH, "openssl"];
  if (process.platform === "win32") {
    try {
      const { stdout } = await execute("where.exe", ["git"], {
        windowsHide: true,
      });
      for (const git of stdout.trim().split(/\r?\n/))
        candidates.push(resolve(dirname(git), "../usr/bin/openssl.exe"));
    } catch {
      /* Git is optional; the normal PATH lookup still applies. */
    }
  }
  for (const command of candidates.filter(Boolean)) {
    try {
      await execute(command, ["version"], { windowsHide: true });
      return command;
    } catch {
      /* Try the next explicit installation. */
    }
  }
  throw new Error(
    "未找到 OpenSSL。请安装 OpenSSL 或 Git for Windows，或设置 OPENSSL_PATH；也可直接配置已有的 TLS_CERT_FILE / TLS_KEY_FILE。",
  );
}

export async function createLocalCertificate(directory, hosts) {
  const names = [...new Set(["localhost", "127.0.0.1", "::1", ...hosts])];
  for (const host of names)
    if (
      !isIP(host) &&
      !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host)
    )
      throw new Error("证书地址必须是 IP 或主机名");
  const openssl = await findOpenSSL();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = join(directory, "server-key.pem"),
    cert = join(directory, "server-cert.pem");
  const caKey = join(directory, "local-ca-key.pem"),
    ca = join(directory, "local-ca.pem");
  for (const filename of [key, cert, caKey, ca]) {
    const exists = await access(filename).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (exists)
      throw new Error(
        "证书目录已有文件，拒绝覆盖已有证书或私钥。请保留现有证书并配置 TLS_CERT_FILE / TLS_KEY_FILE。",
      );
  }
  const csr = join(directory, "server.csr"),
    extensions = join(directory, "server-extensions.cnf");
  const configuration = join(directory, "certificate.cnf");
  // Use an explicit config so a machine's OpenSSL defaults cannot add duplicate extensions.
  await writeFile(
    configuration,
    [
      "[req]",
      "distinguished_name=dn",
      "prompt=no",
      "[dn]",
      "CN=Tuxu Local CA",
      "[ca_extensions]",
      "basicConstraints=critical,CA:TRUE,pathlen:0",
      "keyUsage=critical,keyCertSign,cRLSign",
      "subjectKeyIdentifier=hash",
      "authorityKeyIdentifier=keyid:always",
    ].join("\n"),
  );
  await execute(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:3072",
      "-sha256",
      "-nodes",
      "-days",
      "3650",
      "-config",
      configuration,
      "-extensions",
      "ca_extensions",
      "-subj",
      "/CN=Tuxu Local CA",
      "-keyout",
      caKey,
      "-out",
      ca,
    ],
    { windowsHide: true },
  );
  await chmod(caKey, 0o600);
  await execute(
    openssl,
    [
      "req",
      "-new",
      "-newkey",
      "rsa:3072",
      "-sha256",
      "-nodes",
      "-config",
      configuration,
      "-subj",
      "/CN=Tuxu Local Workspace",
      "-keyout",
      key,
      "-out",
      csr,
    ],
    { windowsHide: true },
  );
  await chmod(key, 0o600);
  await writeFile(
    extensions,
    [
      `subjectAltName=${names.map((host) => `${isIP(host) ? "IP" : "DNS"}:${host}`).join(",")}`,
      "basicConstraints=critical,CA:FALSE",
      "extendedKeyUsage=serverAuth",
      "keyUsage=critical,digitalSignature,keyEncipherment",
      "subjectKeyIdentifier=hash",
      "authorityKeyIdentifier=keyid,issuer",
    ].join("\n"),
  );
  await execute(
    openssl,
    [
      "x509",
      "-req",
      "-in",
      csr,
      "-CA",
      ca,
      "-CAkey",
      caKey,
      "-CAcreateserial",
      "-days",
      "365",
      "-sha256",
      "-extfile",
      extensions,
      "-out",
      cert,
    ],
    { windowsHide: true },
  );
  await unlink(csr);
  await unlink(extensions);
  await unlink(configuration);
  return { key, cert, ca, hosts: names };
}
