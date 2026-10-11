import { productThumbnail } from "../product-thumbnail.js";

import { productPhotos } from "../prompt-suite.js";

export function createThumbnails(context) {
  const thumbnailSources = new Map();
  let thumbnailChain = Promise.resolve();
  function prepareThumbnails() {
    const { state, publish, saveSoon } = context;
    for (const product of state.products) {
      const source = productPhotos(product)[0] || "";
      if (thumbnailSources.get(product.id) === source) continue;
      const existing = product.photoThumbnail;
      if (thumbnailSources.has(product.id) || !source)
        product.photoThumbnail = null;
      thumbnailSources.set(product.id, source);
      if (!source) continue;
      // Decode one original at a time; repeated renders reuse the compressed cache.
      thumbnailChain = thumbnailChain
        .then(async () => {
          if (thumbnailSources.get(product.id) !== source) return;
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
