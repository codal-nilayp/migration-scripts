import "dotenv/config";
import axios from "axios";

/* =======================
   API CLIENT
======================= */
export const createBCClient = (storeHash, token) => {
  return axios.create({
    baseURL: `https://api.bigcommerce.com/stores/${storeHash}/v3`,
    headers: {
      "X-Auth-Token": token,
      Accept: "application/json",
      "Content-Type": "application/json"
    }
  });
};

/* =======================
   SAFE EXECUTOR
======================= */
async function safeExecute(fn, context = "") {
  try {
    const result = await fn();

    if (successMsg) {
      console.log(`✅ ${successMsg}`);
    }

    return result;
  } catch (err) {
    console.error(`❌ Error in ${context}`);
    console.error(err?.response?.data || err.message);
    return null;
  }
}

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
   CATEGORY SYNC
======================= */
export async function syncCategory(prodClient, sandboxClient, categoryId, cache) {
  if (!categoryId) return null;
  if (cache[categoryId]) return cache[categoryId];

  const prodRes = await prodClient.get(`/catalog/categories/${categoryId}`);
  const prodCategory = prodRes.data.data;

  const search = await sandboxClient.get(
    `/catalog/categories?name=${encodeURIComponent(prodCategory.name)}`
  );

  if (search.data.data.length) {
    cache[categoryId] = search.data.data[0].id;
    return cache[categoryId];
  }

  const created = await sandboxClient.post(`/catalog/categories`, {
    name: prodCategory.name,
    parent_id: prodCategory.parent_id
      ? await syncCategory(prodClient, sandboxClient, prodCategory.parent_id, cache)
      : 0,
    is_visible: prodCategory.is_visible,
    description: prodCategory.description
  });

  cache[categoryId] = created.data.data.id;
  return cache[categoryId];
}

/* =======================
   BRAND SYNC
======================= */
export async function syncBrand(prodClient, sandboxClient, brandId, cache) {
  if (!brandId) return null;
  if (cache[brandId]) return cache[brandId];

  const prodBrand = (await prodClient.get(`/catalog/brands/${brandId}`)).data.data;

  const search = await sandboxClient.get(
    `/catalog/brands?name=${encodeURIComponent(prodBrand.name)}`
  );

  if (search.data.data.length) {
    cache[brandId] = search.data.data[0].id;
    return cache[brandId];
  }

  const created = await sandboxClient.post(`/catalog/brands`, {
    name: prodBrand.name,
    is_visible: prodBrand.is_visible,
    meta_description: prodBrand.meta_description,
    search_keywords: prodBrand.search_keywords,
    custom_url: prodBrand.custom_url
  });

  cache[brandId] = created.data.data.id;
  return cache[brandId];
}

/* =======================
   FETCH PRODUCTS
======================= */
export async function getAllProducts(client) {
  let page = 1;
  const products = [];

  while (true) {
    const res = await client.get(
      `/catalog/products?limit=50&page=${page}&include=images,videos,variants,custom_fields`
    );
    products.push(...res.data.data);
    if (!res.data.meta.pagination.links.next) break;
    page++;
  }
  return products;
}

export async function findProductBySKU(client, sku) {
  const res = await client.get(`/catalog/products?sku=${sku}`);
  return res.data.data[0] || null;
}
/* =======================
   IMAGE HELPERS

======================= */
async function getProductImages(client, productId) {
  const res = await client.get(
    `/catalog/products/${productId}/images`
  );
  return res.data.data || [];
}
async function deleteAllProductImages(client, productId) {
  const images = await getProductImages(client, productId);
  for (const img of images) {
    await safeExecute(
      () =>
        client.delete(
          `/catalog/products/${productId}/images/${img.id}`
        ),
      `deleteImage ${img.id}`
    );
  }
}
async function createProductImages(client, productId, images = []) {
  for (const img of images) {
    await safeExecute(
      () =>
        client.post(
          `/catalog/products/${productId}/images`,
          { image_url: img.url_standard }
        ),
      `createImage`
    );
  }
}


/* =======================
   MERGE HELPERS
======================= */
function mergeCustomFieldsForUpdate(existing = [], incoming = []) {
  const merged = [...existing];
  for (const f of incoming) {
    const match = merged.find(e => e.name === f.name);
    if (match) match.value = f.value;
    else merged.push({ name: f.name, value: f.value });
  }
  return merged;
}

export function mergeVariants(existing = [], incoming = []) {
  const merged = [...existing];

  for (const pv of incoming) {
    let match = existing.find(ev => ev.sku === pv.sku);

    if (!match && pv.option_values) {
      match = existing.find(ev =>
        JSON.stringify(ev.option_values) === JSON.stringify(pv.option_values)
      );
    }

    if (match) {
      Object.assign(match, {
        price: pv.price,
        sale_price: pv.sale_price,
        sku: pv.sku,
        inventory_level: pv.inventory_level,
        weight: pv.weight
      });
    } else {
      const v = { ...pv };
      delete v.id;
      merged.push(v);
    }
  }
  return merged;
}

/* =======================
   PRODUCT PAYLOAD
======================= */
export function mapProductPayload(product, categoryMap, isUpdate, existingProduct, brandId) {
  return {
    name: product.name,
    type: product.type,
    sku: product.sku,
    description: product.description,

    price: product.price,
    sale_price: product.sale_price,
    retail_price: product.retail_price,
    cost_price: product.cost_price,

    inventory_tracking: product.inventory_tracking,
    inventory_level: product.inventory_level,

    weight: product.weight,
    width: product.width,
    height: product.height,
    depth: product.depth,

    categories: product.categories.map(id => categoryMap[id]),
    brand_id: brandId,

    mpn: product.mpn,
    upc: product.upc,
    gtin: product.gtin,
    bin_picking_number: product.bin_picking_number,
    tax_code: product.tax_code,

    order_quantity_minimum: product.order_quantity_minimum,
    order_quantity_maximum: product.order_quantity_maximum,

    custom_url: product.custom_url,
    meta_title: product.meta_title,
    meta_description: product.meta_description,

    variants: isUpdate
      ? mergeVariants(existingProduct.variants || [], product.variants || [])
      : product.variants,

    custom_fields: isUpdate
      ? mergeCustomFieldsForUpdate(existingProduct.custom_fields || [], product.custom_fields || [])
      : product.custom_fields.map(f => ({ name: f.name, value: f.value }))
  };
}

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
          `syncCategory ${cid}`
        );
      }

      const existing = await safeExecute(
        () => findProductBySKU(sandboxClient, product.sku),
        `findProduct ${product.sku}`
      );

      const brandId = await safeExecute(
        () => syncBrand(prodClient, sandboxClient, product.brand_id, brandCache),
        `syncBrand ${product.brand_id}`
      );

      let sandboxProductId;

      if (!existing) {
        console.log("Creating product...");
        const payload = mapProductPayload(product, categoryMap, false, {}, brandId);
        const created = await safeExecute(
          () => sandboxClient.post(`/catalog/products`, payload),
          `createProduct ${product.sku}`
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
            `createImage`
          );
        }

        for (const vid of product.videos || []) {
          await safeExecute(
            () => sandboxClient.post(`/catalog/products/${sandboxProductId}/videos`, vid),
            `createVideo`
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
          `updateProduct ${product.sku}`
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


async function getProductModifiers(client, productId) {
  const res = await client.get(
    `/catalog/products/${productId}/modifiers`
  );
  return res.data.data || [];
}
function findModifier(existingModifiers, modifier) {
  return existingModifiers.find(
    m =>
      m.display_name === modifier.display_name &&
      m.type === modifier.type
  );
}
function buildModifierPayload(modifier) {
  const payload = {
    type: modifier.type,
    display_name: modifier.display_name,
    required: modifier.required,
    sort_order: modifier.sort_order,
    config: modifier.config
  };

  // ❗ Checkbox modifiers must NOT include option_values
  if (modifier.type !== "checkbox") {
    payload.option_values = modifier.option_values?.map(o => ({
      label: o.label,
      sort_order: o.sort_order,
      is_default: o.is_default,
      adjusters: o.adjusters
    }));
  }

  return payload;
}
async function createModifier(client, productId, modifier) {
  const payload = buildModifierPayload(modifier);

  return client.post(
    `/catalog/products/${productId}/modifiers`,
    payload
  );
}
async function updateModifier(client, productId, modifierId, modifier) {
  const payload = buildModifierPayload(modifier);

  return client.put(
    `/catalog/products/${productId}/modifiers/${modifierId}`,
    payload
  );
}
export async function syncModifiers(
  prodClient,
  sandboxClient,
  prodProductId,
  sandboxProductId
) {
  const prodModifiers = await getProductModifiers(
    prodClient,
    prodProductId
  );
  if (!prodModifiers.length) return;

  const sandboxModifiers = await getProductModifiers(
    sandboxClient,
    sandboxProductId
  );

  for (const prodModifier of prodModifiers) {
    const existing = findModifier(sandboxModifiers, prodModifier);

    if (existing) {
      console.log(`✏️ Updating modifier: ${prodModifier.display_name}`);

      await safeExecute(
        () =>
          updateModifier(
            sandboxClient,
            sandboxProductId,
            existing.id,
            prodModifier
          ),
        `updateModifier (${prodModifier.display_name})`
      );
    } else {
      console.log(`➕ Creating modifier: ${prodModifier.display_name}`);

      await safeExecute(
        () =>
          createModifier(
            sandboxClient,
            sandboxProductId,
            prodModifier
          ),
        `createModifier (${prodModifier.display_name})`
      );
    }
  }
}
