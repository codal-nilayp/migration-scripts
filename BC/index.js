import "dotenv/config";
import createBCClient from './client.js'
import syncCategory from './category.js'
import syncBrand from './brand.js'
import { getAllProducts, findProductBySKU, deleteAllProductImages, createProductImages, mapProductPayload } from './product.js'
import safeExecute from './helper.js'
import syncModifiers from './modifier.js'

/* =======================
   CLIENTS
======================= */
const prodClient = createBCClient(
  process.env.PROD_STORE_HASH,
  process.env.PROD_ACCESS_TOKEN
);

const sandboxClient = createBCClient(
  process.env.SANDBOX_STORE_HASH,
  process.env.SANDBOX_ACCESS_TOKEN
);

/* =======================
   MAIN RUNNER
======================= */
(async () => {
  console.log("Fetching products from production...");
  const products = await getAllProducts(prodClient);
  const categoryCache = {};
  const brandCache = {};

  for (const product of products) {
    try {
      console.log(`\n🔄 ${product.name} (${product.sku})`);

      const categoryMap = {};
      for (const cid of product.categories || []) {
        categoryMap[cid] = await safeExecute(
          () => syncCategory(prodClient, sandboxClient, cid, categoryCache),
          `syncCategory ${cid}`,
          "Sync Category"
        );
      }

      const existing = await safeExecute(
        () => findProductBySKU(sandboxClient, product.sku),
        `findProduct ${product.sku}`
      );

      const brandId = await safeExecute(
        () => syncBrand(prodClient, sandboxClient, product.brand_id, brandCache),
        `syncBrand ${product.brand_id}`,
        "Sync Brand"
      );

      let sandboxProductId;

      if (!existing) {
        console.log("Creating product...");
        const payload = mapProductPayload(product, categoryMap, false, {}, brandId);
        const created = await safeExecute(
          () => sandboxClient.post(`/catalog/products`, payload),
          `createProduct ${product.sku}`,
          "Product Created"
        );
        if (!created) continue;
        

        sandboxProductId = created.data.data.id;
        await syncModifiers(
          prodClient,
          sandboxClient,
          product.id,
          sandboxProductId
        );

        for (const img of product.images || []) {
          await safeExecute(
            () => sandboxClient.post(`/catalog/products/${sandboxProductId}/images`, { image_url: img.url_standard }),
            `createImage`,
            "Image created"
          );
        }

        for (const vid of product.videos || []) {
          await safeExecute(
            () => sandboxClient.post(`/catalog/products/${sandboxProductId}/videos`, vid),
            `createVideo`,
            "Video created"
          );
        }

      } else {
        console.log("Updating product...");
        const existingRes = await sandboxClient.get(
          `/catalog/products/${existing.id}?include=custom_fields,variants`
        );

        const payload = mapProductPayload(
          product,
          categoryMap,
          true,
          existingRes.data.data,
          brandId
        );
        await deleteAllProductImages(
          sandboxClient,
          existing.id
        );
        await createProductImages(
          sandboxClient,
          existing.id,
          product.images
        );

        await safeExecute(
          () => sandboxClient.put(`/catalog/products/${existing.id}`, payload),
          `updateProduct ${product.sku}`,
          "Product Updated"
        );
        await syncModifiers(
          prodClient,
          sandboxClient,
          product.id,
          existing.id
        );
      }
    } catch (err) {
      console.error(`💥 Fatal product error ${product.sku}`, err.message);
    }
  }

  console.log("\n✅ PRODUCT SYNC COMPLETED");
})();



