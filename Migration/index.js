import "dotenv/config";
import axios from "axios";

/* =======================
   CONFIG
======================= */
const BC_LIMIT = 250;
const METAFIELD_BATCH = 100;
const RATE_DELAY = 300;

/* =======================
   CLIENTS
======================= */
const bc = axios.create({
  baseURL: `https://api.bigcommerce.com/stores/${process.env.BC_STORE_HASH}/v3`,
  headers: {
    "X-Auth-Token": process.env.BC_TOKEN,
    "Content-Type": "application/json",
    Accept: "application/json"
  }
});

const shopify = axios.create({
  baseURL: `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/${process.env.SHOPIFY_API_VERSION}`,
  headers: {
    "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
    "Content-Type": "application/json"
  }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* =======================
   BIGCOMMERCE FETCHERS
======================= */
async function fetchAllBCProducts() {
  let page = 1;
  let products = [];

  while (true) {
    console.log(`📥 Fetching BC products page ${page}`);

    const res = await safeExecute(async () => {
      const { data } = await bc.get("/catalog/products", {
        params: {
          page,
          limit: BC_LIMIT,
          include: "images,variants,custom_fields,primary_image,options"
        }
      });
      return data;
    }, "Fetch BC products");

    if (!res?.data?.length) break;
    products.push(...res.data);
    page++;
  }

  return products;
}

async function fetchCategory(categoryId) {
  return safeExecute(async () => {
    const { data } = await bc.get(`/catalog/categories/${categoryId}`);
    return data.data;
  }, `Fetch category ${categoryId}`);
}

async function fetchBrand(brandId) {
  if (!brandId) return null;
  return safeExecute(async () => {
    const { data } = await bc.get(`/catalog/brands/${brandId}`);
    return data.data?.name || null;
  }, `Fetch brand ${brandId}`);
}

/* =======================
   COLLECTIONS
======================= */
async function getOrCreateCollection(title) {
  const found = await safeExecute(async () => {
    const { data } = await shopify.get("/custom_collections.json", {
      params: { title }
    });
    return data.custom_collections?.[0];
  }, `Find collection ${title}`);

  if (found) return found.id;

  const created = await safeExecute(async () => {
    const { data } = await shopify.post("/custom_collections.json", {
      custom_collection: { title, published: true }
    });
    return data.custom_collection;
  }, `Create collection ${title}`);

  return created?.id;
}

async function addProductToCollection(productId, collectionId) {
  await safeExecute(async () => {
    await shopify.post("/collects.json", {
      collect: { product_id: productId, collection_id: collectionId }
    });
  }, "Add product to collection");
}

/* =======================
   OPTIONS
======================= */
function mapOptions(bcOptions) {
  return bcOptions.map((opt) => ({
    name: opt.display_name,
    values: opt.option_values.map((v) => v.label)
  }));
}

/* =======================
   IMAGE UPLOAD
======================= */
async function uploadMediaToShopify(productId, src, alt = "") {
  const uploaded = await safeExecute(async () => {
    const { data } = await shopify.post(`/products/${productId}/images.json`, {
      image: { src, alt }
    });
    return data.image;
  }, "Upload media to Shopify");

  return uploaded;
}

/* =======================
   VARIANT MAPPING (UPDATED)
======================= */
async function mapVariants(variants, bcOptions, productId, productImages) {
  const imageIdMap = {};

  for (const img of productImages) {
    const uploaded = await uploadMediaToShopify(
      productId,
      img.url_standard,
      img.alt_text || img.description || ""
    );
    if (uploaded?.id) imageIdMap[img.id] = uploaded.id;
  }

  const mappedVariants = [];

  for (const v of variants) {
    let variantImageId = null;

    if (v.image_url && !imageIdMap[v.image_id]) {
      const uploaded = await uploadMediaToShopify(productId, v.image_url);
      if (uploaded?.id) variantImageId = uploaded.id;
    } else if (v.image_id && imageIdMap[v.image_id]) {
      variantImageId = imageIdMap[v.image_id];
    }

    const variantPayload = {
      sku: v.sku,
      price: v.sale_price,                 // ✅ BC Sales Price → Shopify Price
      compare_at_price: v.retail_price || null,    // ✅ BC MSRP → Compare-at
      cost: v.cost_price || null,          // ✅ BC Cost → Shopify Cost
      inventory_management: "shopify",
      inventory_quantity: v.inventory_level,
      weight: v.weight,
      weight_unit: "kg",
      barcode: v.upc || v.ean || null,
      requires_shipping: true,
      image_id: variantImageId,
      metafields: [
        { namespace: "Bigc", key: "low_stock", value: String(v.inventory_warning_level || 0), type: "number_integer" },
        { namespace: "Bigc", key: "bin_picking_number", value: v.bin_picking_number || "", type: "single_line_text_field" },
        { namespace: "Bigc", key: "mpn", value: v.mpn || "", type: "single_line_text_field" },
        { namespace: "Bigc", key: "country_of_origin", value: v.country_of_origin || "", type: "single_line_text_field" },
        { namespace: "Bigc", key: "hs_code", value: v.hs_code || "", type: "single_line_text_field" },
        { namespace: "Bigc", key: "width", value: String(v.width || ""), type: "single_line_text_field" },
        { namespace: "Bigc", key: "height", value: String(v.height || ""), type: "single_line_text_field" },
        { namespace: "Bigc", key: "depth", value: String(v.depth || ""), type: "single_line_text_field" }
      ]
    };
    bcOptions.forEach((opt, index) => {
      const selected = v.option_values?.find((ov) => ov.option_id === opt.id);
      if (selected) variantPayload[`option${index + 1}`] = selected.label;
    });

    mappedVariants.push(variantPayload);
  }

  return mappedVariants;
}

/* =======================
   IMAGES
======================= */
function mapImages(images) {
  return [...images]
    .sort((a, b) => b.is_thumbnail - a.is_thumbnail)
    .map((img) => ({
      src: img.url_standard,
      alt: img.description || img.alt_text || ""
    }));
}

/* =======================
   METAFIELDS
======================= */
function mapProductMetafields(customFields) {
  return customFields.map((f) => {
    let key = f.name.replace(/\W+/g, "_").toLowerCase();
    if (key.length < 3) key = `_${key}`;
    return {
      namespace: "Bigc",
      key,
      value: f.value,
      type: "single_line_text_field"
    };
  });
}

async function createProductMetafields(productId, metafields) {
  const batches = chunk(metafields, METAFIELD_BATCH);

  for (let i = 0; i < batches.length; i++) {
    console.log(`   ↳ Metafields batch ${i + 1}/${batches.length}`);
    for (const mf of batches[i]) {
      await safeExecute(async () => {
        await shopify.post(`/products/${productId}/metafields.json`, { metafield: mf });
      }, "Create product metafield");
    }
  }
}

/* =======================
   PRODUCT MIGRATION
======================= */
async function migrateProduct(bcProduct, index, total) {
  console.log(`\n🚚 [${index}/${total}] ${bcProduct.name}`);

  try {
    const options = mapOptions(bcProduct.options || []);
    const images = mapImages(bcProduct.images || []);
    const vendorName = bcProduct.brand_id ? await fetchBrand(bcProduct.brand_id) : "";

    const productPayload = {
      product: {
        title: bcProduct.name,
        body_html: bcProduct.description,
        vendor: vendorName || "",
        product_type: bcProduct.type || "",
        status: bcProduct.is_visible ? "active" : "draft",
        options,
        images
      }
    };
    console.log('productPayload',JSON.stringify(productPayload));
    const created = await safeExecute(async () => {
      const { data } = await shopify.post("/products.json", productPayload);
      return data.product;
    }, "Create Shopify product");

    if (!created) throw new Error("Product creation failed");

    const variants = await mapVariants(
      bcProduct.variants || [],
      bcProduct.options || [],
      created.id,
      bcProduct.images || []
    );

    if (variants.length) {
      await safeExecute(async () => {
        await shopify.put(`/products/${created.id}.json`, { product: { variants } });
      }, "Update product with variants");
    }

    if (bcProduct.categories?.length) {
      for (const catId of bcProduct.categories) {
        const catData = await fetchCategory(catId);
        if (catData?.name) {
          const collectionId = await getOrCreateCollection(catData.name);
          if (collectionId) await addProductToCollection(created.id, collectionId);
        }
      }
    }

    if (bcProduct.custom_fields?.length) {
      await createProductMetafields(created.id, mapProductMetafields(bcProduct.custom_fields));
    }

    console.log(`🎉 SUCCESS: ${bcProduct.name}`);
  } catch (err) {
    console.error(`🔥 FAILED: ${bcProduct.name}`);
    console.error(err.message);
  }
}

/* =======================
   RUNNER
======================= */
(async () => {
  console.log("🚀 BigCommerce → Shopify Migration Started");

  const products = await fetchAllBCProducts();
  console.log(`📦 Products found: ${products.length}`);
  for (let i = 0; i < products.length; i++) {
    await migrateProduct(products[i], i + 1, products.length);
    await sleep(RATE_DELAY);
  }

  console.log("\n✅ Migration completed");
})();
