import "dotenv/config";
import axios from "axios";

/* ==============================
   CONFIG
============================== */
const {
  PROD_SHOP,
  PROD_TOKEN,
  SANDBOX_SHOP,
  SANDBOX_TOKEN,
} = process.env;

const prodClient = axios.create({
  baseURL: `https://${PROD_SHOP}/admin/api/2024-10/`,
  headers: {
    "X-Shopify-Access-Token": PROD_TOKEN,
    "Content-Type": "application/json",
  },
});

const sandboxClient = axios.create({
  baseURL: `https://${SANDBOX_SHOP}/admin/api/2024-10/`,
  headers: {
    "X-Shopify-Access-Token": SANDBOX_TOKEN,
    "Content-Type": "application/json",
  },
});

/* =======================
   SAFE EXECUTE
======================= */
async function safeExecute(fn, label) {
    try {
      return await fn();
    } catch (err) {
      console.error(`❌ ${label}`);
      console.error(err?.response?.data || err.message);
      return null;
    }
}

/* ==============================
   FETCH PRODUCTS (50)
============================== */
async function fetchProducts(pageInfo = null) {
  const url = pageInfo
    ? `/products.json?limit=50&page_info=${pageInfo}`
    : `/products.json?limit=50`;

  return safeExecute(() => prodClient.get(url), "fetchProducts");
}

/* ==============================
   FIND PRODUCT BY HANDLE
============================== */
async function findSandboxProductByHandle(handle) {
  return safeExecute(async () => {
    const res = await sandboxClient.get(`/products.json?handle=${handle}`);
    return res.data.products[0] || null;
  }, "findSandboxProductByHandle");
}

/* ==============================
   FETCH VARIANTS (100)
============================== */
async function fetchAllVariants(productId) {
  let variants = [];
  let pageInfo = null;
  let hasNext = true;

  while (hasNext) {
    const url = pageInfo
      ? `/products/${productId}/variants.json?limit=100&page_info=${pageInfo}`
      : `/products/${productId}/variants.json?limit=100`;

    const res = await safeExecute(() => prodClient.get(url), "fetchVariants");
    if (!res) break;

    variants.push(...res.data.variants);

    const link = res.headers?.link;
    if (link?.includes('rel="next"')) {
      pageInfo = link.match(/page_info=([^&>]+)/)?.[1];
      hasNext = !!pageInfo;
    } else {
      hasNext = false;
    }
  }

  return variants;
}

/* ==============================
   CREATE / UPDATE PRODUCT
   (NO OPTIONS, NO VARIANTS)
============================== */
async function upsertProduct(product, sandboxProductId = null) {
    try{
        let options = product.options.map(o =>({
            name: o.name,
            values: o.values
          }));
        const media = await fetchAllMedia(product.id);
        const images = media.map(i=>({
            src: i.src,
            alt: i.alt || ""
          }));
          var payload = {
            product: {
              title: product.title,
              body_html: product.body_html,
              vendor: product.vendor,
              product_type: product.product_type,
              status: product.status,
              tags: product.tags,
              template_suffix: product.template_suffix,
              seo: product.seo
                ? {
                    title: product.seo.title,
                    meta_description: product.seo.description,
                  }
                : undefined,
                options,
                images
            },
          };

    } catch (err) {
        console.error(`🔥 FAILED: ${bcProduct.name}`);
        console.error(err.message);
    }
    if (sandboxProductId) {
        const res = await safeExecute(
          () => sandboxClient.put(`/products/${sandboxProductId}.json`, payload),
          "productUpdate"
        );
        return res?.data?.product?.id || sandboxProductId;
    } else {
        const res = await safeExecute(
          () => sandboxClient.post(`/products.json`, payload),
          "productCreate"
        );
        return res?.data?.product?.id || null;
    }
}

/* ==============================
   UPDATE PRODUCT OPTIONS
============================== */
async function updateProductOptions(productId, variants) {
  let optionNames = product.options.map(o =>({
    name: o.name
  }))
  if (!optionNames.length) return;

  const payload = { product: { options: optionNames } };

  await safeExecute(
    () => sandboxClient.put(`/products/${productId}.json`, payload),
    "updateProductOptions"
  );
}

/* ==============================
   UPSERT VARIANTS (SEPARATE)
============================== */
async function upsertVariants(productId, variants) {
  const existing = await safeExecute(
    () => sandboxClient.get(`/products/${productId}/variants.json`),
    "fetchSandboxVariants"
  );

  const existingVariants = existing?.data?.variants || [];

  for (const v of variants) {
    const found = existingVariants.find(ev => ev.sku === v.sku);

    const payload = {
      variant: {
        product_id: productId,
        title: v.title,
        sku: v.sku,
        barcode: v.barcode,
        price: v.price,
        compare_at_price: v.compare_at_price,
        inventory_quantity: v.inventory_quantity,
        weight: v.weight,
        weight_unit: v.weight_unit,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        position: v.position,
      },
    };

    if (found) {
      await safeExecute(
        () =>
          sandboxClient.put(
            `/variants/${found.id}.json`,
            payload
          ),
        "variantUpdate"
      );
    } else {
      await safeExecute(
        () =>
          sandboxClient.post(
            `/products/${productId}/variants.json`,
            payload
          ),
        "variantCreate"
      );
    }
  }
}

/* ==============================
   FETCH MEDIA (50)
============================== */
async function fetchAllMedia(productId) {
  let media = [];
  let pageInfo = null;
  let hasNext = true;

  while (hasNext) {
    const url = pageInfo
      ? `/products/${productId}/images.json?limit=50&page_info=${pageInfo}`
      : `/products/${productId}/images.json?limit=50`;

    const res = await safeExecute(() => prodClient.get(url), "fetchMedia");
    if (!res) break;

    media.push(...res.data.images);

    const link = res.headers?.link;
    if (link?.includes('rel="next"')) {
      pageInfo = link.match(/page_info=([^&>]+)/)?.[1];
      hasNext = !!pageInfo;
    } else {
      hasNext = false;
    }
  }

  return media;
}

/* ==============================
   UPLOAD MEDIA (BASE64)
============================== */
async function uploadMedia(productId, mediaList) {
  for (const media of mediaList) {
    try {
      const img = await axios.get(media.src, {
        responseType: "arraybuffer",
        timeout: 20000,
      });

      const payload = {
        image: {
          attachment: Buffer.from(img.data).toString("base64"),
          alt: media.alt || "",
        },
      };

      await safeExecute(
        () => sandboxClient.post(`/products/${productId}/images.json`, payload),
        "uploadMedia"
      );
    } catch {
      console.error(`❌ Image failed: ${media.src}`);
    }
  }
}

/* ==============================
   FETCH METAFIELDS (50)
============================== */
async function fetchAllProductMetafields(productId) {
  let metafields = [];
  let pageInfo = null;
  let hasNext = true;

  while (hasNext) {
    const url = pageInfo
      ? `/products/${productId}/metafields.json?limit=50&page_info=${pageInfo}`
      : `/products/${productId}/metafields.json?limit=50`;

    const res = await safeExecute(() => prodClient.get(url), "fetchMetafields");
    if (!res) break;

    metafields.push(...res.data.metafields);

    const link = res.headers?.link;
    if (link?.includes('rel="next"')) {
      pageInfo = link.match(/page_info=([^&>]+)/)?.[1];
      hasNext = !!pageInfo;
    } else {
      hasNext = false;
    }
  }

  return metafields;
}

/* ==============================
   UPSERT METAFIELDS
============================== */
async function upsertMetafields(ownerId, metafields) {
  for (const mf of metafields) {
    await safeExecute(
      () =>
        sandboxClient.post(`/metafields.json`, {
          metafield: {
            namespace: mf.namespace,
            key: mf.key,
            type: mf.type,
            value: mf.value,
            owner_id: ownerId,
            owner_resource: "product",
          },
        }),
      "metafieldUpsert"
    );
  }
}

/* ==============================
   MAIN MIGRATION
============================== */
async function migrate() {
  let pageInfo = null;
  let hasNext = true;

  while (hasNext) {
    const res = await fetchProducts(pageInfo);
    if (!res) break;

    const products = res.data.products;

    for (const product of products) {
      console.log(`➡ Migrating ${product.handle}`);

      const sandboxProduct = await findSandboxProductByHandle(product.handle);
      const sandboxProductId = await upsertProduct(product, sandboxProduct?.id);

    //   const variants = await fetchAllVariants(product.id);

    //   const sandboxProduct = await findSandboxProductByHandle(product.handle);
      

    //   await updateProductOptions(sandboxProductId, product);
    //   await upsertVariants(sandboxProductId, variants);

    //   const media = await fetchAllMedia(product.id);
    //   await uploadMedia(sandboxProductId, media);

    //   const metafields = await fetchAllProductMetafields(product.id);
    //   await upsertMetafields(sandboxProductId, metafields);
    }

    if (products.length < 50) hasNext = false;
    else pageInfo = products[products.length - 1].id;
  }
}

migrate().catch(console.error);
