import { downloadImage } from "../production/assets.ts";
// Isolated compatibility adapter for the explicitly selected demo environment.
export function shimoImages() {
  const middleware = async (req, res, next) => {
    if (req.url !== "/api/shimo-image") return next();
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end();
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 12000) throw new Error("Request too large");
      }
      const url = new URL(JSON.parse(body).url);
      if (
        url.hostname !== "uploader.shimo.im" ||
        !/^\/f\/[^/]+\.(png|jpe?g|webp|gif)$/i.test(url.pathname)
      )
        throw new Error("Unsupported image URL");
      const { bytes, mime } = await downloadImage(
        url.href,
        AbortSignal.timeout(20000),
        ["uploader.shimo.im", "oimages2.shimonote.com"],
      );
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "no-store");
      res.end(bytes);
    } catch {
      res.statusCode = 502;
      res.end("Unable to load image");
    }
  };
  return {
    name: "legacy-shimo",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
