import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_VERSION = process.env.API_VERSION || "2026-01";
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

/* --------------------------------------------------
   GraphQL Clients
-------------------------------------------------- */

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
const sandboxClient = getClient(process.env.SANDBOX_STORE, process.env.SANDBOX_TOKEN);

/* --------------------------------------------------
   Safe Execute Wrapper
-------------------------------------------------- */

async function safeExecute(client, query, variables = {}, label = "") {
  try {
    const response = await client.post("", { query, variables });
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
    {  },
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
          name: val
        }))
      })),
  };
  const data = await safeExecute(
    sandboxClient,
    mutation,
    { input },
    "Create Product",
  );

  if (data?.productCreate?.userErrors?.length) {
    console.error("❌ Product Create Errors:", data.productCreate.userErrors);
    return null;
  }
  return data?.productCreate?.product;
}
/* --------------------------------------------------
   Update Product
-------------------------------------------------- */
async function updateProduct(productId, product) {
  const mutation = `
  mutation updateProduct($input:ProductInput!){
    productUpdate(input:$input){
      product{ id }
      userErrors{ field message }
    }
  }`;

  const input = {
    id: productId,
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
  };

  console.log(`Updating product: ${product.title}`);

  return safeExecute(sandboxClient, mutation, { input });
}
/* --------------------------------------------------
   Fetch Media
-------------------------------------------------- */

async function fetchMedia(productId,cursor = null) {
  const query = `
    query($id: ID!, $cursor: String) {
      product(id:$id){
        media(first: 50, after: $cursor) {
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
    { id: productId, cursor:cursor },
    "Fetch Media"
  );

  return data;
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
    originalSource:
      media.image?.url || media.sources?.[0]?.url,
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
/* --------------------------------------------------
   Fetch Variants 50 by 50
-------------------------------------------------- */
async function fetchSandboxVariants(productId) {
  const query = `
  query($id:ID!){
    product(id:$id){
      variants(first:250){
        nodes{
          id
          sku
        }
      }
    }
  }`;

  const data = await safeExecute(sandboxClient, query, { id: productId });

  return data.product.variants.nodes;
}

/* --------------------------------------------------
   Fetch Sandbox Variants 50 by 50
-------------------------------------------------- */
async function fetchSandboxVariants(productId) {
  const query = `
  query($id:ID!){
    product(id:$id){
      variants(first:250){
        nodes{
          id
          sku
        }
      }
    }
  }`;

  const data = await safeExecute(sandboxClient, query, { id: productId });

  return data.product.variants.nodes;
}

/* --------------------------------------------------
   Create Variants
-------------------------------------------------- */

async function createVariants(product, variants,locationId) {
  var productId = product.id;
  const mutation = `
    mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){
      productVariantsBulkCreate(productId:$productId, variants:$variants){
        productVariants { id sku }
        userErrors { field message }
      }
    }
  `;
  const updateMut = `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku }
      userErrors {
        field
        message
      }
    }
  }`
  var UpdateOne;
  var formatted = variants.map(v => {
    var isNew = true; 
    if(v.selectedOptions[0]?.name){
      if(product.variants.nodes[0]?.title.indexOf(v.selectedOptions[0]?.value) == -1 ){
        isNew = false;
      }
    }
    if(v.selectedOptions[1]?.name){
      if(product.variants.nodes[0]?.title.indexOf(v.selectedOptions[1]?.value) == -1 ){
        isNew = false;
      }
    }
    if(v.selectedOptions[2]?.name){
      if(product.variants.nodes[0]?.title.indexOf(v.selectedOptions[2]?.value) == -1 ){
        isNew = false;
      }
    }
    if(!isNew){
      var newCreatedOne =  {
        barcode: v.barcode,
        compareAtPrice: v.compareAtPrice,
        inventoryItem: {
          cost: v.inventoryItem.unitCost,
          countryCodeOfOrigin: v.inventoryItem.countryCodeOfOrigin,
          harmonizedSystemCode: v.inventoryItem.harmonizedSystemCode,
          provinceCodeOfOrigin: v.inventoryItem.provinceCodeOfOrigin,
          requiresShipping: v.inventoryItem.requiresShipping,
          measurement: {
            weight: v.inventoryItem.measurement.weight
          },
          sku: v.inventoryItem.sku,
          tracked: v.inventoryItem.tracked
        },
        price: v.price,
        inventoryPolicy: v.inventoryPolicy,
        requiresComponents: v.requiresComponents,
        showUnitPrice: v.showUnitPrice,
        taxable: v.taxable,
        taxCode: v.taxCode,
        unitPriceMeasurement: v.unitPriceMeasurement,
        optionValues: v.selectedOptions.map((opt) => ({
          optionName: opt.name,
          name: opt.value
        })),
      }
      if(newCreatedOne.inventoryItem.tracked){
        newCreatedOne.inventoryQuantities = {
          availableQuantity: v.inventoryQuantity,
          locationId: locationId
        }
      }
      return newCreatedOne;
    }else{
      UpdateOne = [{
        barcode: v.barcode,
        compareAtPrice: v.compareAtPrice,
        inventoryItem: {
          cost: v.inventoryItem.unitCost,
          countryCodeOfOrigin: v.inventoryItem.countryCodeOfOrigin,
          harmonizedSystemCode: v.inventoryItem.harmonizedSystemCode,
          provinceCodeOfOrigin: v.inventoryItem.provinceCodeOfOrigin,
          requiresShipping: v.inventoryItem.requiresShipping,
          measurement: {
            weight: v.inventoryItem.measurement.weight
          },
          sku: v.inventoryItem.sku,
          tracked: v.inventoryItem.tracked
        },
        price: v.price,
        inventoryPolicy: v.inventoryPolicy,
        inventoryQuantities: {
          availableQuantity: v.inventoryQuantity,
          locationId: locationId
        },
        requiresComponents: v.requiresComponents,
        showUnitPrice: v.showUnitPrice,
        taxable: v.taxable,
        taxCode: v.taxCode,
        unitPriceMeasurement: v.unitPriceMeasurement,
        optionValues: v.selectedOptions.map((opt) => ({
          optionName: opt.name,
          name: opt.value
        })),
      }]
    }

  });
  var updatedVariants; 
  
  formatted = formatted.filter(value => value !== null);

  const data = await safeExecute(
    sandboxClient,
    mutation,
    { productId, variants: formatted },
    "Create Variants"
  );
  if(UpdateOne){
    await safeExecute(
      sandboxClient,
      productVariantDeleteQuery,
      { productId, variantsIds: [product.variants.nodes[0].id] },
      "First Variant Deleted"
    );
    updatedVariants = await safeExecute(
      sandboxClient,
      mutation,
      { productId, variants: UpdateOne },
      "Create Variants"
    )
    
  }
  var allData = [];
  if(data?.productVariantsBulkCreate?.productVariants){
    allData = [...allData,...data?.productVariantsBulkCreate?.productVariants]
  }
  if(updatedVariants?.productVariantsBulkCreate?.productVariants){
    allData = [...allData,...updatedVariants?.productVariantsBulkCreate?.productVariants]
  }
  const variantMap = {};
  allData.forEach((createdVariant) => {
    const match = variants.find(
      (v) => v.sku === createdVariant.sku
    );
    if (match) {
      variantMap[match.id] = createdVariant.id;
    }
  });
  migrateVariantMetafieldsUsingNode(variantMap);
  return variantMap;
}
/* --------------------------------------------------
   Migrate Metafields
-------------------------------------------------- */
async function migrateVariantMetafieldsUsingNode(objectMap) {
  const query = `
    query($id:ID!,$cursor:String){
      node(id:$id){
        ... on HasMetafields{
          metafields(first:50, after:$cursor){
            pageInfo{
              hasNextPage
              endCursor
            }
            nodes{
              namespace
              key
              type
              value
            }
          }
        }
      }
    }
  `;

  for (const sourceVariantId in objectMap) {
    let cursor = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await safeExecute(
        prodClient,
        query,
        { id: sourceVariantId, cursor },
        "Fetch Variant Metafields (node)"
      );

      const metafields =
        data?.node?.metafields?.nodes || [];

      hasNextPage =
        data?.node?.metafields?.pageInfo?.hasNextPage;

      cursor =
        data?.node?.metafields?.pageInfo?.endCursor;

      if (!metafields.length) continue;

      const inputs = metafields.map((mf) => ({
        ownerId: objectMap[sourceVariantId],
        namespace: mf.namespace,
        key: mf.key,
        type: mf.type,
        value: mf.value,
      }));

      await safeExecute(
        sandboxClient,
        `
        mutation($metafields:[MetafieldsSetInput!]!){
          metafieldsSet(metafields:$metafields){
            userErrors{ field message }
          }
        }
        `,
        { metafields: inputs },
        "Create Variant Metafields"
      );
    }
  }
}
/* -------------------------------------------------- */
/* Map Media To Variants */
/* -------------------------------------------------- */

async function mapVariantMedia(prodVariants, mediaMap, variantMap, newProduct) {
  const productId = newProduct.id;
  const mutation = `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku }
      userErrors {
        field
        message
      }
    }
  }`

  for (const variant of prodVariants) {
    const prodMediaId = variant.media?.nodes?.[0]?.id;
    if (!prodMediaId) continue;

    const sandboxMediaId = mediaMap[prodMediaId];
    const sandboxVariantId = variantMap[variant.id];

    if (!sandboxMediaId || !sandboxVariantId) continue;

    const d = await safeExecute(
      sandboxClient,
      mutation,
      {
        productId: productId,
        variants: [
          {
            id: sandboxVariantId,
            mediaId: sandboxMediaId,
          },
        ],
      },
      "Map Variant Media"
    );
  }
}
/* --------------------------------------------------
   MAIN MIGRATION
-------------------------------------------------- */

async function migrate() {
  const locationId = await getSandboxLocationId();
  console.log("🚀 Starting Product Migration...\n");

  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await fetchProducts(cursor);

    const products = data?.products?.nodes || [];
    hasNextPage = data?.products?.pageInfo?.hasNextPage;
    cursor = data?.products?.pageInfo?.endCursor;

    for (const product of products) {
      console.log(`\n📦 Processing: ${product.title}`);

      const exists = await productExists(product.handle);

      if (exists) {
        console.log("   ⚠️ Already exists. Skipping.");
        await updateProduct(exists.id, product);
      }else{
        const newProduct = await createProduct(product);
        if (!newProduct) { 
          console.log("   ❌ Product note created skipping.");  
          continue;
        }
        console.log("   ✅ Product Created");
        const mediaMap = {};
        let mediaCursor = null;
        let mediaHasNextPage = true;
        while (mediaHasNextPage) {
            var mediadata = await fetchMedia(product.id,mediaCursor);
            var mediaList = mediadata?.product?.media?.nodes || [];

            mediaHasNextPage = mediadata?.products?.media.pageInfo?.hasNextPage || false;
            cursor = data?.products?.pageInfo?.endCursor || null;
            for (const media of mediaList) {
              console.log("   🖼 Uploading media...");
              const newMediaId = await uploadMedia(newProduct.id, media);
              if (newMediaId) mediaMap[media.id] = newMediaId;
            }
        }
      }
      // const mediaList = await fetchMedia(product.id);
      // for (const media of mediaList) {
      //   console.log("   🖼 Uploading media...");
      //   const newMediaId = await uploadMedia(newProduct.id, media);
      //   if (newMediaId) mediaMap[media.id] = newMediaId;
      // }

      // Variants
      let vCursor = null;
      let more = true;

      while (more) {
        const prodVariants = await fetchVariants(product.id, vCursor);
        const sandboxVariants = await fetchSandboxVariants(newProduct.id);
        const sandboxMap = new Map();
        sandboxVariants.forEach((v) => sandboxMap.set(v.sku, v));
        

        const variants =
          prodVariants?.product?.variants?.nodes || [];

        more =
          prodVariants?.product?.variants?.pageInfo?.hasNextPage;

        vCursor =
          prodVariants?.product?.variants?.pageInfo?.endCursor;

        if (variants.length) {
          if (exists) {
            // 

          }else{
            console.log(`   🔹 Creating ${variants.length} variants`);
            const variantMap = await createVariants(newProduct, variants,locationId);
            await mapVariantMedia(variants, mediaMap, variantMap, newProduct);
          }
        }
      }

      // Metafields
      console.log("   🔖 Migrating Metafields");
      var objectMap = {};
      objectMap[product.id] = newProduct.id;
      await migrateVariantMetafieldsUsingNode(objectMap);

      console.log(`   🎉 Finished: ${product.title}`);
    }
  }

  console.log("\n🏁 Migration Completed");
}

migrate();