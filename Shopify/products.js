const axios = require('axios');

/* ================= CONFIG ================= */

const PROD_STORE = 'nilay-dev.myshopify.com';
const PROD_TOKEN = 'shpat_xxx';

const SANDBOX_STORE = 'nilay-test-plus.myshopify.com';
const SANDBOX_TOKEN = 'shpat_xxx';

const API_VERSION = '2026-01';

const PROD_API = `https://${PROD_STORE}/admin/api/${API_VERSION}/graphql.json`;
const SANDBOX_API = `https://${SANDBOX_STORE}/admin/api/${API_VERSION}/graphql.json`;

/* ================= GRAPHQL HELPER ================= */

async function graphqlRequest(url, token, query, variables = {}) {
  const res = await axios.post(
    url,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': token } }
  );

  if (res.data.errors) {
    console.error('GraphQL Errors:', JSON.stringify(res.data.errors, null, 2));
  }

  return res.data.data;
}

/* ================= LOCATION ================= */

async function getSandboxLocationId() {
  const query = `
    query {
      locations(first: 1) {
        edges { node { id } }
      }
    }
  `;
  const data = await graphqlRequest(SANDBOX_API, SANDBOX_TOKEN, query);
  return data.locations.edges[0].node.id;
}

/* ================= FETCH PROD PRODUCTS ================= */

async function fetchProducts() {
  const query = `
    query ($cursor: String) {
      products(first: 50, after: $cursor) {
        pageInfo { hasNextPage }
        edges {
          cursor
          node {
            title
            handle
            descriptionHtml
            vendor
            productType
            tags
            publishedAt

            options { name values }

            seo { title description }

            metafields(first: 50) {
              edges {
                node {
                  namespace
                  key
                  value
                  type
                }
              }
            }

            media(first: 50) {
              edges {
                node {
                  mediaContentType
                  ... on MediaImage {
                    image { url altText }
                  }
                }
              }
            }

            variants(first: 100) {
              edges {
                node {
                  price
                  compareAtPrice
                  barcode
                  inventoryQuantity

                  inventoryItem { tracked }

                  selectedOptions { name value }
                  image { url }
                  metafields(first: 50) {
                    edges {
                      node {
                        namespace
                        key
                        value
                        type
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  let products = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await graphqlRequest(PROD_API, PROD_TOKEN, query, { cursor });
    products.push(...data.products.edges.map(e => e.node));
    hasNextPage = data.products.pageInfo.hasNextPage;
    cursor = hasNextPage ? data.products.edges.at(-1).cursor : null;
  }

  return products;
}

/* ================= CREATE PRODUCT ================= */

async function createProduct(product) {
  const mutation = `
    mutation ($input: ProductInput!) {
      productCreate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }
  `;

  const input = {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    published: !!product.publishedAt,

    productOptions: product.options.map(o => ({
      name: o.name,
      values: o.values.map(v => ({ name: v }))
    })),

    metafields: product.metafields.edges.map(m => ({
      namespace: m.node.namespace,
      key: m.node.key,
      value: m.node.value,
      type: m.node.type
    })),

    seo: product.seo
  };

  const data = await graphqlRequest(
    SANDBOX_API,
    SANDBOX_TOKEN,
    mutation,
    { input }
  );

  return data.productCreate.product.id;
}

/* ================= MEDIA (ONE BY ONE) ================= */

async function uploadSingleMedia(productId, imageUrl, altText = '') {
  const mutation = `
    mutation ($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status }
        userErrors { message }
      }
    }
  `;

  const data = await graphqlRequest(
    SANDBOX_API,
    SANDBOX_TOKEN,
    mutation,
    {
      productId,
      media: [{
        mediaContentType: 'IMAGE',
        originalSource: imageUrl,
        alt: altText
      }]
    }
  );

  return data.productCreateMedia.media[0].id;
}

async function waitForMediaReady(mediaId, timeoutMs = 30000) {
  const start = Date.now();

  const query = `
    query ($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          id
          status
          image { url }
        }
      }
    }
  `;

  while (Date.now() - start < timeoutMs) {
    const data = await graphqlRequest(
      SANDBOX_API,
      SANDBOX_TOKEN,
      query,
      { id: mediaId }
    );

    const media = data.node;

    if (media?.status === 'READY' && media.image?.url) {
      return media.id;
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  throw new Error(`Media ${mediaId} processing timeout`);
}

async function uploadProductImagesIndividually(productId, mediaEdges) {
  const mediaMap = {}; // sourceUrl → mediaId

  for (const edge of mediaEdges) {
    if (edge.node.mediaContentType !== 'IMAGE') continue;
    if (!edge.node.image?.url) continue;

    const sourceUrl = edge.node.image.url;
    const alt = edge.node.image.altText || '';

    console.log(`🖼 Uploading image: ${sourceUrl}`);

    const mediaId = await uploadSingleMedia(productId, sourceUrl, alt);
    const readyMediaId = await waitForMediaReady(mediaId);

    mediaMap[sourceUrl] = readyMediaId;
  }

  return mediaMap;
}

/* ================= VARIANTS ================= */

async function fetchExistingVariants(productId) {
  const query = `
    query ($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          edges {
            node {
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;
  const data = await graphqlRequest(SANDBOX_API, SANDBOX_TOKEN, query, { id: productId });
  return data.product.variants.edges;
}

function variantExists(existing, variant) {
  const key = variant.node.selectedOptions
    .map(o => `${o.name}:${o.value}`)
    .sort()
    .join('|');

  return existing.some(e =>
    e.node.selectedOptions
      .map(o => `${o.name}:${o.value}`)
      .sort()
      .join('|') === key
  );
}

async function createVariants(productId, variants, locationId, mediaMap) {
  const existingVariants = await fetchExistingVariants(productId);

  const variantsInput = variants.edges
    .filter(v => !variantExists(existingVariants, v))
    .map(v => {
      const tracked = v.node.inventoryItem?.tracked === true;

      const input = {
        price: v.node.price,
        compareAtPrice: v.node.compareAtPrice,
        barcode: v.node.barcode,

        optionValues: v.node.selectedOptions.map(o => ({
          optionName: o.name,
          name: o.value
        })),

        mediaId: v.node.image?.url
          ? mediaMap[v.node.image.url] || null
          : null,

        inventoryItem: { tracked },
        metafields:v.node.metafields.edges.map(m => ({
          namespace: m.node.namespace,
          key: m.node.key,
          value: m.node.value,
          type: m.node.type
        }))
      };

      if (tracked) {
        input.inventoryQuantities = [{
          locationId,
          availableQuantity: v.node.inventoryQuantity || 0
        }];
      }

      return input;
    });

  if (!variantsInput.length) return;

  const mutation = `
    mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }
  `;

  await graphqlRequest(
    SANDBOX_API,
    SANDBOX_TOKEN,
    mutation,
    { productId, variants: variantsInput }
  );
}
/* ================= MAIN ================= */

(async () => {
  console.log('🔍 Fetching sandbox location...');
  const locationId = await getSandboxLocationId();

  console.log('📦 Fetching products from production...');
  const products = await fetchProducts();

  for (const product of products) {
    console.log(`➡ Migrating: ${product.title}`);

    const productId = await createProduct(product);

    const mediaMap = await uploadProductImagesIndividually(
      productId,
      product.media.edges
    );

    await createVariants(
      productId,
      product.variants,
      locationId,
      mediaMap
    );

    console.log(`✅ Completed: ${product.title}`);
  }

  console.log('🎉 Migration finished successfully');
})();
