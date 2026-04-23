import "dotenv/config";
import fetch from "node-fetch";

/* =======================
   SAFE EXECUTOR
======================= */
async function safeExecute(fn, context = "", successMsg = "") {
  try {
    const result = await fn();
    if (successMsg) console.log(`✅ ${successMsg} - ${context}`);
    return result;
  } catch (err) {
    console.error(`❌ Error in ${context}`);
    console.error(err?.response?.errors || err.message || err);
    return null;
  }
}

/* =======================
   SHOPIFY API HELPER
======================= */
const SHOPIFY_API_VERSION = "2023-10";

async function shopifyFetch(storeDomain, accessToken, query, variables = {}) {
  const res = await fetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

/* =======================
   CONFIGURATION
======================= */
const PROD_STORE = {
  domain: process.env.PROD_STORE_DOMAIN,
  token: process.env.PROD_STORE_TOKEN,
};
const SANDBOX_STORE = {
  domain: process.env.SANDBOX_STORE_DOMAIN,
  token: process.env.SANDBOX_STORE_TOKEN,
};

/* =======================
   PAGINATED FETCH FUNCTION
======================= */
async function fetchPaginated(store, query, dataPath, cursor = null, accumulated = []) {
  const res = await safeExecute(() => shopifyFetch(store.domain, store.token, query, { cursor }), `Fetch ${dataPath}`);
  if (!res) return accumulated;

  let edges = res.data;
  const paths = dataPath.split(".");
  for (let path of paths) edges = edges[path];
  accumulated.push(...edges.edges.map(e => e.node));

  const hasNextPage = edges.pageInfo?.hasNextPage;
  const endCursor = edges.pageInfo?.endCursor;

  if (hasNextPage) return fetchPaginated(store, query, dataPath, endCursor, accumulated);
  return accumulated;
}

/* =======================
   PRODUCT FUNCTIONS
======================= */
async function fetchAllProducts(store) {
  const query = `
    query($cursor: String) {
      products(first: 50, after: $cursor) {
        edges {
          cursor
          node {
            id
            handle
            title
            descriptionHtml
            productType
            vendor
            tags
            status
            options { id name values }
            seo { title description }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  return fetchPaginated(store, query, "products");
}

async function checkProductExists(store, handle) {
  const query = `
    query($handle: String!) {
      productByHandle(handle: $handle) { id }
    }
  `;
  const res = await safeExecute(() => shopifyFetch(store.domain, store.token, query, { handle }), `Check Product Exists - ${handle}`);
  return res?.data?.productByHandle || null;
}

async function createOrUpdateProduct(store, product) {
  const existing = await checkProductExists(store, product.handle);

  const input = {
    title: product.title,
    bodyHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status: product.status.toUpperCase(),
    handle: product.handle,
    seo: product.seo ? { title: product.seo.title, description: product.seo.description } : undefined,
  };

  if (!existing) {
    console.log(input);
    const mutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product { id handle }
          userErrors { field message }
        }
      }
    `;
    const res = await safeExecute(() => shopifyFetch(store.domain, store.token, mutation, { input }), `Create Product - ${product.handle}`, `Product Created`);
    return res?.data?.productCreate?.product;
  } else {
    const mutation = `
      mutation productUpdate($id: ID!, $input: ProductInput!) {
        productUpdate(id: $id, input: $input) {
          product { id handle }
          userErrors { field message }
        }
      }
    `;
    const res = await safeExecute(() => shopifyFetch(store.domain, store.token, mutation, { id: existing.id, input }), `Update Product - ${product.handle}`, `Product Updated`);
    return res?.data?.productUpdate?.product;
  }
}

/* =======================
   VARIANTS
======================= */
async function fetchVariants(store, productId) {
  const query = `
    query($productId: ID!, $cursor: String) {
      product(id: $productId) {
        variants(first: 50, after: $cursor) {
          edges { cursor node { id title sku price compareAtPrice inventoryQuantity optionValues { name value } metafields(first:50){ edges { node { key value namespace type }}} } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  return fetchPaginated(store, query, "product.variants");
}

async function createOrUpdateVariant(store, productId, variant) {
  const input = {
    title: variant.title,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    inventoryQuantity: variant.inventoryQuantity,
    optionValues: variant.optionValues,
    metafields: variant.metafields?.map(m => ({ key: m.key, value: m.value, namespace: m.namespace, type: m.type })),
  };

  const mutation = `
    mutation variantUpsert($id: ID!, $input: ProductVariantInput!) {
      productVariantUpdate(id: $id, input: $input) {
        productVariant { id }
        userErrors { field message }
      }
    }
  `;
  return safeExecute(() => shopifyFetch(store.domain, store.token, mutation, { id: variant.id, input }), `Variant Upsert - ${variant.sku}`, `Variant Processed`);
}

/* =======================
   MEDIA
======================= */
async function fetchMedia(store, productId) {
  const query = `
    query($productId: ID!, $cursor: String) {
      product(id: $productId) {
        images(first: 50, after: $cursor) {
          edges { cursor node { id src altText } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  return fetchPaginated(store, query, "product.images");
}

async function createOrUpdateMedia(store, productId, media) {
  const input = {
    src: media.src,
    altText: media.altText,
  };
  const mutation = `
    mutation productImageCreate($productId: ID!, $input: [ImageInput!]!) {
      productImagesCreate(productId: $productId, images: $input) {
        images { id src }
        userErrors { field message }
      }
    }
  `;
  return safeExecute(() => shopifyFetch(store.domain, store.token, mutation, { productId, input: [input] }), `Media Upsert - ${media.src}`, `Media Processed`);
}

/* =======================
   METAFIELDS
======================= */
async function fetchMetafields(store, productId) {
  const query = `
    query($productId: ID!, $cursor: String) {
      product(id: $productId) {
        metafields(first: 50, after: $cursor) {
          edges { cursor node { id namespace key value type } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  return fetchPaginated(store, query, "product.metafields");
}

async function createOrUpdateMetafields(store, productId, metafields) {
  for (const m of metafields) {
    const input = {
      namespace: m.namespace,
      key: m.key,
      value: m.value,
      type: m.type,
      ownerId: productId,
    };
    const mutation = `
      mutation metafieldUpsert($input: MetafieldInput!) {
        metafieldUpsert(input: $input) {
          metafield { id }
          userErrors { field message }
        }
      }
    `;
    await safeExecute(() => shopifyFetch(store.domain, store.token, mutation, { input }), `Metafield Upsert - ${m.namespace}.${m.key}`, `Metafield Processed`);
  }
}

/* =======================
   MAIN PROCESS
======================= */
async function main() {
  console.log("🔄 Starting Shopify Product Migration...");

  const products = await fetchAllProducts(PROD_STORE);

  for (const product of products) {
    console.log(`\n📦 Processing Product: ${product.handle}`);

    // Create or update product in Sandbox
    const sandboxProduct = await createOrUpdateProduct(SANDBOX_STORE, product);
    if (!sandboxProduct) continue;

    // VARIANTS
    const variants = await fetchVariants(PROD_STORE, product.id);
    for (const variant of variants) {
      await createOrUpdateVariant(SANDBOX_STORE, sandboxProduct.id, variant);
    }

    // MEDIA
    const media = await fetchMedia(PROD_STORE, product.id);
    for (const m of media) {
      await createOrUpdateMedia(SANDBOX_STORE, sandboxProduct.id, m);
    }

    // METAFIELDS
    const metafields = await fetchMetafields(PROD_STORE, product.id);
    await createOrUpdateMetafields(SANDBOX_STORE, sandboxProduct.id, metafields);
  }

  console.log("\n✅ Shopify Product Migration Completed!");
}

main();
