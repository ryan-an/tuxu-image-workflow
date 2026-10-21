import { productPage } from "../view-models/product-page.js";
import { productThumbnail } from "../view-models/product-thumbnail.js";

import { productPhotos } from "../../shared/prompt-suite.js";

export function createThumbnails(context) {
  const thumbnailSources = new Map();
  let thumbnailChain = Promise.resolve();
  function prepareThumbnails() {
    const { state, publish, saveSoon } = context;
    for (const product of productPage(state, context.ui).products) {
      const source = productPhotos(product)[0] || "";
      // Production previews are generated and cached on demand by the asset endpoint.
      if (/^\/api\/assets\/[a-f0-9]{64}$/.test(source)) continue;
      if (thumbnailSources.get(product.id) === source) continue;
      const existing = product.photoThumbnail;
      if (thumbnailSources.has(product.id) || !source)
        product.photoThumbnail = null;
      thumbnailSources.set(product.id, source);
      if (!source) continue;
      // Decode one original at a time; repeated renders reuse the compressed cache.
      thumbnailChain = thumbnailChain
        .then(async () => {
          if (
            thumbnailSources.get(product.id) !== source ||
            !productPage(state, context.ui).products.some(
              (p) => p.id === product.id,
            )
          ) {
            thumbnailSources.delete(product.id);
            return;
          }
          const thumbnail = await productThumbnail(source, existing);
          if (thumbnailSources.get(product.id) !== source) return;
          product.photoThumbnail = thumbnail;
          publish();
          saveSoon();
        })
        .catch(() => {
          // A failed preview keeps its placeholder and never falls back to a full original.
          if (thumbnailSources.get(product.id) === source) {
            product.photoThumbnail = null;
            publish();
            saveSoon();
          }
        });
    }
  }

  return { prepareThumbnails };
}
