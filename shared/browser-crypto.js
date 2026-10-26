// Keep the browser client usable over plain HTTP during IP-based deployments.
const webCrypto = () => globalThis.crypto;

export function randomUuid() {
  const cryptoApi = webCrypto();
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") cryptoApi.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Thumbnail cache keys are not security-sensitive. Use SHA-256 when available,
// and a deterministic fallback when subtle.digest is blocked on HTTP.
export async function digestHex(value) {
  const bytes = new TextEncoder().encode(value);
  const cryptoApi = webCrypto();
  if (typeof cryptoApi?.subtle?.digest === "function") {
    const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (const byte of bytes) for (let index = 0; index < words.length; index++) {
    words[index] = Math.imul((words[index] ^ (byte + index)) >>> 0, 0x01000193 + index * 2) >>> 0;
    words[index] = (words[index] ^ (words[index] >>> 13)) >>> 0;
  }
  return words.map((word) => word.toString(16).padStart(8, "0")).join("");
}
