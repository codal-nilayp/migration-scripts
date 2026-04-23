import axios from "axios";
import dotenv from "dotenv";
import pLimit from "p-limit";

dotenv.config();

const limit = pLimit(3);
const PAGE_SIZE = 50;

const prodClient = createClient(
  process.env.PROD_SHOP,
  process.env.PROD_TOKEN
);

const sandboxClient = createClient(
  process.env.SANDBOX_SHOP,
  process.env.SANDBOX_TOKEN
);

/* ---------------- CLIENT ---------------- */

function createClient(shop, token) {
  return axios.create({
    baseURL: `https://${shop}/admin/api/${process.env.API_VERSION}`,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
}

/* ---------------- GRAPHQL HELPER ---------------- */

async function gql(client, query, variables = {}) {
  const { data } = await client.post("/graphql.json", {
    query,
    variables,
  });

  if (data.errors) {
    console.error(JSON.stringify(data.errors, null, 2));
    throw new Error("GraphQL Error");
  }

  return data.data;
}

/* ---------------- FETCH PRODUCTS ---------------- */

async function fetchProducts(cursor = null) {
  const query = `
  query ($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          vendor
          productType
          status
          tags
          templateSuffix
          seo { title description }
          featuredMedia { preview { image { url } } }

          options { name values }

          metafields(first: 100) {
            edges {
              node { namespace key value type }
            }
          }

          media(first: 100) {
            edges {
              node {
                __typename
                ... on MediaImage {
                  image { url altText }
                }
                ... on Video {
                  sources { url }
                }
              }
            }
          }

          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                position
                selectedOptions { name value }

                metafields(first: 100) {
                  edges {
                    node { namespace key value type }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

  return gql(prodClient, query, { cursor });
}

/* ---------------- CHECK PRODUCT EXISTS ---------------- */

async function getProductByHandle(handle) {
  const query = `
  query ($handle: String!) {
    productByHandle(handle: $handle) {
      id
      variants(first: 100) { edges { node { id sku } } }
    }
  }`;

  return gql(sandboxClient, query, { handle });
}

/* ---------------- CREATE PRODUCT ---------------- */

async function createProduct(product) {
  const mutation = `
  mutation ($input: ProductInput!) {
    productCreate(input: $input) {
      product { id }
      userErrors { field message }
    }
  }`;

  const input = {
    title: product.title,
    handle: product.handle,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status,
    tags: product.tags,
    templateSuffix: product.templateSuffix,
    seo: product.seo,
    options: product.options.map(o => o.name),
    metafields: mapMetafields(product.metafields),
  };

  return gql(sandboxClient, mutation, { input });
}

/* ---------------- MEDIA SYNC ---------------- */

async function uploadMedia(productId, media) {
  for (const m of media) {
    const src =
      m.__typename === "MediaImage"
        ? m.image.url
        : m.sources?.[0]?.url;

    if (!src) continue;

    const mutation = `
    mutation ($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        userErrors { message }
      }
    }`;

    await gql(sandboxClient, mutation, {
      productId,
      media: [{ originalSource: src }],
    });

    await wait(1500);
  }
}

/* ---------------- VARIANT SYNC ---------------- */

async function syncVariants(productId, variants) {
  for (const v of variants) {
    const mutation = `
    mutation ($input: ProductVariantInput!) {
      productVariantCreate(input: $input) {
        productVariant { id }
        userErrors { message }
      }
    }`;

    await gql(sandboxClient, mutation, {
      input: {
        productId,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        barcode: v.barcode,
        options: v.selectedOptions.map(o => o.value),
        metafields: mapMetafields(v.metafields),
      },
    });
  }
}

/* ---------------- UTILS ---------------- */

function mapMetafields(mf) {
  return mf.edges.map(e => ({
    namespace: e.node.namespace,
    key: e.node.key,
    value: e.node.value,
    type: e.node.type,
  }));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- MAIN ---------------- */

async function run() {
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const data = await fetchProducts(cursor);

    for (const { node: product } of data.products.edges) {
      await limit(async () => {
        console.log(`Syncing: ${product.handle}`);

        const existing = await getProductByHandle(product.handle);

        let productId;

        if (!existing.productByHandle) {
          const created = await createProduct(product);
          productId = created.productCreate.product.id;
        } else {
          productId = existing.productByHandle.id;
        }

        await uploadMedia(productId, product.media.edges.map(e => e.node));
        await syncVariants(productId, product.variants.edges.map(e => e.node));
      });
    }

    hasNext = data.products.pageInfo.hasNextPage;
    cursor = data.products.pageInfo.endCursor;
  }
}

run().catch(console.error);
