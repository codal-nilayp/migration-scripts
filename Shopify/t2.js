import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_VERSION = process.env.API_VERSION || "2026-01";

/* --------------------------------------------------
   GraphQL Clients
-------------------------------------------------- */

const productVariantDeleteQuery = `#graphql
mutation bulkDeleteProductVariants($productId: ID!, $variantsIds: [ID!]!) {
  productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
    product {
      id
      title
    }
    userErrors {
      field
      message
    }
  }
}`;

function getClient(store, token) {
  return axios.create({
    baseURL: `https://${store}/admin/api/${API_VERSION}/graphql.json`,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
  });
}

const prodClient = getClient(process.env.PROD_STORE, process.env.PROD_TOKEN);

const sandboxClient = getClient(
  process.env.SANDBOX_STORE,
  process.env.SANDBOX_TOKEN
);

/* --------------------------------------------------
   Safe Execute Wrapper
-------------------------------------------------- */

async function safeExecute(
  client,
  query,
  variables = {},
  label = "",
  $log = false
) {
  try {
    const response = await client.post("", { query, variables });

    if ($log) {
      console.log("response", response);
    }

    if (response.data.errors) {
      console.error(`❌ GraphQL Error (${label})`, response.data.errors);
      return null;
    }

    const data = response.data.data;

    return data;
  } catch (error) {
    console.error(`❌ API Error (${label})`, error.message);
    return null;
  }
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

  const data = await safeExecute(
    sandboxClient,
    query,
    {},
    "Fetch the Sandbox Location"
  );

  return data.locations.edges[0].node.id;
}

/* --------------------------------------------------
   Check Product Exists
-------------------------------------------------- */

async function productExists(handle) {
  const query = `
    query($query:String!) {
      products(first:1, query:$query) {
        nodes { id handle }
      }
    }
  `;

  const data = await safeExecute(
    sandboxClient,
    query,
    { query: `handle:${handle}` },
    "Check Product Exists"
  );

  return data?.products?.nodes?.[0] || null;
}

/* --------------------------------------------------
   Fetch Products 50 by 50
-------------------------------------------------- */

async function fetchProducts(cursor = null) {
  const query = `
    query($cursor:String){
      products(first:50, after:$cursor){
        pageInfo { hasNextPage endCursor }
        nodes{
          options{
            id
            name
            values
          }
          category{
            id
          }
          id
          title
          descriptionHtml
          productType
          vendor
          status
          tags
          templateSuffix
          handle
          category { name }
          seo { title description }
          collections(first:50){ nodes { id handle } }
          featuredMedia { id }
        }
      }
    }
  `;

  return safeExecute(prodClient, query, { cursor }, "Fetch Products");
}

/* --------------------------------------------------
   Create Product
-------------------------------------------------- */

async function createProduct(product) {
  const mutation = `
    mutation($input:ProductInput!){
      productCreate(input:$input){
        product { 
          id 
          handle
          variants(first: 5){
            nodes{
              id
              title
              inventoryItem{
                id
              }
              selectedOptions {
                name
                value
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const input = {
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    productType: product.productType,
    vendor: product.vendor,
    status: product.status,
    category: product.category?.id,
    tags: product.tags,
    templateSuffix: product.templateSuffix,
    handle: product.handle,
    seo: product.seo,
    productOptions: product.options.map((opt) => ({
      name: opt.name,
      values: opt.values.map((val) => ({
        name: val,
      })),
    })),
  };

  const data = await safeExecute(
    sandboxClient,
    mutation,
    { input },
    "Create Product"
  );

  if (data?.productCreate?.userErrors?.length) {
    console.error("❌ Product Create Errors:", data.productCreate.userErrors);
    return null;
  }

  return data?.productCreate?.product;
}

/* --------------------------------------------------
   Fetch Media
-------------------------------------------------- */

async function fetchMedia(productId) {
  const query = `
    query($id:ID!){
      product(id:$id){
        media(first:50){
          nodes{
            id
            alt
            mediaContentType
            ... on MediaImage {
              image { url }
            }
            ... on Video {
              sources { url }
            }
            ... on Model3d {
              sources { url }
            }
          }
        }
      }
    }
  `;

  const data = await safeExecute(
    prodClient,
    query,
    { id: productId },
    "Fetch Media"
  );

  return data?.product?.media?.nodes || [];
}

/* --------------------------------------------------
   Upload Media & Wait Until READY
-------------------------------------------------- */

async function uploadMedia(productId, media) {
  const mutation = `
    mutation($productId:ID!,$media:[CreateMediaInput!]!){
      productCreateMedia(productId:$productId, media:$media){
        media { id status }
        userErrors { field message }
      }
    }
  `;

  const input = {
    originalSource: media.image?.url || media.sources?.[0]?.url,
    mediaContentType: media.mediaContentType,
    alt: media.alt,
  };

  const data = await safeExecute(
    sandboxClient,
    mutation,
    { productId, media: [input] },
    "Upload Media"
  );

  const mediaId = data?.productCreateMedia?.media?.[0]?.id;
  if (!mediaId) return null;

  console.log("   ⏳ Waiting for media processing...");

  let ready = false;

  while (!ready) {
    await new Promise((r) => setTimeout(r, 2000));

    const checkQuery = `
      query($id:ID!){
        node(id:$id){
          ... on Media { status }
        }
      }
    `;

    const statusData = await safeExecute(
      sandboxClient,
      checkQuery,
      { id: mediaId },
      "Check Media Status"
    );

    if (statusData?.node?.status === "READY") {
      ready = true;
    }
  }

  console.log("   ✅ Media Ready");
  return mediaId;
}

/* --------------------------------------------------
   Fetch Variants 50 by 50
-------------------------------------------------- */

async function fetchVariants(productId, cursor = null) {
  const query = `
    query($id:ID!,$cursor:String){
      product(id:$id){
        options(first: 3){
          id
          name
        }
        variants(first:50, after:$cursor){
          pageInfo { hasNextPage endCursor }
          nodes{
            media(first:1){
              nodes{
                id
              }
            }
            id
            sku
            barcode
            price
            compareAtPrice
            inventoryQuantity
            inventoryPolicy
            taxable
            selectedOptions { name value }
            inventoryItem{
              unitCost{
                amount
                currencyCode
              }
              countryCodeOfOrigin
              harmonizedSystemCode
              provinceCodeOfOrigin
              requiresShipping
              measurement{ 
                weight{
                  unit
                  value
                }
              }
              sku,
              tracked
            }
            requiresComponents
            showUnitPrice
            taxable
            taxCode
            unitPriceMeasurement{
              quantityUnit
              quantityValue
              referenceUnit
              referenceValue
            }
          }
        }
      }
    }
  `;

  return safeExecute(
    prodClient,
    query,
    { id: productId, cursor },
    "Fetch Variants"
  );
}