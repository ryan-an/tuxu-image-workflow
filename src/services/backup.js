// Backups carry their image bytes, so they remain portable across servers.
export async function portableBackup(state) {
  const cache = new Map();
  const visit = async (value) => {
    if (
      typeof value === "string" &&
      /^\/api\/assets\/[a-f0-9]{64}$/.test(value)
    ) {
      if (!cache.has(value))
        cache.set(
          value,
          (async () => {
            const response = await fetch(value);
            if (!response.ok) throw new Error("备份图片读取失败，请重试");
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            });
          })(),
        );
      return cache.get(value);
    }
    if (Array.isArray(value)) {
      const result = [];
      for (const v of value) result.push(await visit(v));
      return result;
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, v] of Object.entries(value))
        result[key] = await visit(v);
      return result;
    }
    return value;
  };
  return visit(structuredClone(state));
}
