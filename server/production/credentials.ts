import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
// Identify the configured encrypted credential version without storing a key
// or exposing a reusable API-key fingerprint in scheduler records.
export const credentialVersion = (encrypted: string | null) =>
  createHash("sha256")
    .update(encrypted || "")
    .digest("hex");
export class Credentials {
  private key: Buffer;
  constructor(secret: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(secret))
      throw new Error("CREDENTIAL_SECRET 必须为 32 字节十六进制密钥");
    this.key = Buffer.from(secret, "hex");
  }
  encrypt(value: string) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const content = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), content]).toString(
      "base64",
    );
  }
  decrypt(value: string) {
    const bytes = Buffer.from(value, "base64"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        bytes.subarray(0, 12),
      );
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
}
