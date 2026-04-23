import "dotenv/config";
import axios from "axios";

export const createBCClient = (storeHash, token) => {
  return axios.create({
    baseURL: `https://api.bigcommerce.com/stores/${storeHash}/v3`,
    headers: {
      "X-Auth-Token": token,
      "Accept": "application/json",
      "Content-Type": "application/json"
    }
  });
};
export async function syncCategory(prodClient, sandboxClient, categoryId, cache) {
  if (cache[categoryId]) return cache[categoryId];

  const { data } = await prodClient.get(`/catalog/categories/${categoryId}`);
  const prodCategory = data.data;

  // Check if exists in sandbox
  const { data: search } = await sandboxClient.get(
    `/catalog/categories?name=${encodeURIComponent(prodCategory.name)}`
  );

  if (search.data.length) {
    cache[categoryId] = search.data[0].id;
    return search.data[0].id;
  }

  // Create category
  const { data: created } = await sandboxClient.post(`/catalog/categories`, {
    name: prodCategory.name,
    parent_id: prodCategory.parent_id
      ? await syncCategory(prodClient, sandboxClient, prodCategory.parent_id, cache)
      : 0,
    is_visible: prodCategory.is_visible,
    description: prodCategory.description
  });

  cache[categoryId] = created.data.id;
  return created.data.id;
}

const prodClient = createBCClient(
  process.env.PROD_STORE_HASH,
  process.env.PROD_ACCESS_TOKEN
);

const sandboxClient = createBCClient(
  process.env.SANDBOX_STORE_HASH,
  process.env.SANDBOX_ACCESS_TOKEN
);

(async () => {
  console.log("Fetching products from production...");
  const products = await getAllProducts(prodClient);

  const categoryCache = {};

  for (const product of products) {
    console.log(`Processing: ${product.name}`);

    // Sync categories
    const categoryMap = {};
    for (const catId of product.categories) {
      categoryMap[catId] = await syncCategory(
        prodClient,
        sandboxClient,
        catId,
        categoryCache
      );
    }


    const existing = await findProductBySKU(sandboxClient, product.sku);
    const brandCache = {};

    const sandboxBrandId = await syncBrand(prodClient, sandboxClient, product?.brand_id, brandCache);
    const payload = mapProductPayload(product, categoryMap,false,[],sandboxBrandId);
    let sandboxProductId;
    if (!existing) {
      console.log("Creating product...");
      

      const { data } = await sandboxClient.post(`/catalog/products`, payload);
      sandboxProductId = data.data.id;

      for (const image of product.images || []) {
        await sandboxClient.post(`/catalog/products/${sandboxProductId}/images`, {
          image_url: image.url_standard
        });
      }

      // Videos
      for (const video of product.videos || []) {
        await sandboxClient.post(`/catalog/products/${sandboxProductId}/videos`, video);
      }

    } else {
      console.log("Updating product...");
      const { data } = await sandboxClient.get(`/catalog/products/${existing.id}?include=custom_fields,images,variants,options,primary_image`);
      const existingProduct = data.data || [];

      const payload = mapProductPayload(product, categoryMap, true, existingProduct,sandboxBrandId);
      await sandboxClient.put(`/catalog/products/${existing.id}`, payload);
      sandboxProductId = existing.id;
    }
    // 🔥 Sync modifiers separately (AFTER product exists)
    // await syncProductModifiers({
    //   prodClient,
    //   sandboxClient,
    //   prodProductId: product.id,
    //   sandboxProductId
    // });
  }

  console.log("✅ Product sync completed");
})();

function mergeCustomFieldsForUpdate(existingFields = [], prodFields = []) {
  const merged = [...existingFields]; // start with existing
  for (const pf of prodFields) {
    const match = existingFields.find(ef => ef.name == pf.name);

    if (match) {
      // update value but keep the ID
      match.value = pf.value;
    } else {
      // new field → no ID
      merged.push({ name: pf.name, value: pf.value });
    }
  }

  return merged;
}
export async function getAllProducts(client) {
    let page = 1;
    let products = [];
  
    while (true) {
      const { data } = await client.get(
        `/catalog/products?limit=50&page=${page}&include=images,videos,variants,custom_fields,modifiers`
      );
  
      products.push(...data.data);
      if (!data.meta.pagination.links.next) break;
      page++;
    }
    return products;
  }
  
export async function findProductBySKU(client, sku) {
  const { data } = await client.get(`/catalog/products?sku=${sku}`);
  return data.data[0] || null;
}
  
export function mapProductPayload(product, categoryMap, isUpdate = false, existingProduct = [],brandId = null) {
  return {
      // Basic product info
    name: product.name,
    type: product.type,
    sku: product.sku,
    description: product.description,
    // Pricing
    price: product.price,
    sale_price: product.sale_price,
    retail_price: product.retail_price,
    cost_price: product.cost_price,
    // Inventory
    inventory_tracking: product.inventory_tracking,
    inventory_level: product.inventory_level,
    inventory_warning_level: product.inventory_warning_level,
    // Dimensions & Shipping
    weight: product.weight,
    width: product.width,
    height: product.height,
    depth: product.depth,
    // Categories & Brand
    categories: product.categories.map(id => categoryMap[id]),
    brand_id: brandId,
      // Purchasability
    is_visible: product.is_visible,
    availability: product.availability,
    order_quantity_minimum: product.order_quantity_minimum, // Minimum Purchase Quantity
    order_quantity_maximum: product.order_quantity_maximum, // Maximum Purchase Quantity
      // Identifiers
    mpn: product.mpn,      // Manufacturer Part Number
    upc: product.upc,      // Product UPC/EAN
    gtin: product.gtin,    // Global Trade Item Number
    bin_picking_number: product.bin_picking_number,      // Bin Picking Number
    tax_code: product.tax_code, // Tax Provider Tax Code
    // SEO
    custom_url: product.custom_url,
    meta_title: product.meta_title,
    meta_description: product.meta_description,
    meta_keywords: product.meta_keywords,
      // Customs info
    customs_info: product.customs_info,
    variants: isUpdate ? mergeVariants(existingProduct.variants,product.variants): product.variants,
    custom_fields: isUpdate
    ? mergeCustomFieldsForUpdate(existingProduct.custom_fields, product.custom_fields)
    : product.custom_fields.map(f => ({ name: f.name, value: f.value })),
      // extra 
    is_free_shipping: product.is_free_shipping,
    is_featured: product.is_featured,
    warranty: product.warranty,
    layout_file: product.layout_file,
    search_keywords: product.search_keywords,
    availability_description: product.availability_description,
    sort_order: product.sort_order,
    condition: product.condition,
    is_condition_shown: product.is_condition_shown,
    page_title: product.page_title,
    custom_url: product.custom_url,
    preorder_release_date: product.preorder_release_date,
    preorder_message: product.preorder_message,
    is_preorder_only: product.is_preorder_only,
    is_price_hidden: product.is_price_hidden,
    price_hidden_label: product.price_hidden_label,
  };
}
  



/**
 * Merge product variants during update
 * @param {Array} existingVariants - variants fetched from Sandbox product
 * @param {Array} prodVariants - variants from Production product
 * @returns {Array} mergedVariants - ready to send in update API
 */
export function mergeVariants(existingVariants = [], prodVariants = []) {
  const merged = [...existingVariants];

  for (const pv of prodVariants) {
    // Try to match by SKU first (most reliable)
    let match = existingVariants.find(ev => ev.sku === pv.sku);

    // Fallback: match by option combination if SKU is missing
    if (!match && pv.option_values) {
      match = existingVariants.find(ev => {
        if (!ev.option_values) return false;
        if (ev.option_values.length !== pv.option_values.length) return false;

        return ev.option_values.every((v, i) => 
          v.option_display_name === pv.option_values[i].option_display_name &&
          v.label === pv.option_values[i].label
        );
      });
    }

    if (match) {
      // Update fields but keep the ID
      match.price = pv.price;
      match.sale_price = pv.sale_price;
      match.retail_price = pv.retail_price;
      match.sku = pv.sku;
      match.inventory_level = pv.inventory_level;
      match.inventory_warning_level = pv.inventory_warning_level;
      match.weight = pv.weight;
      match.option_values = pv.option_values;
    } else {
      // New variant → remove ID for creation
      const newVariant = { ...pv };
      delete newVariant.id;
      merged.push(newVariant);
    }
  }

  return merged;
}




/**
 * Sync brand from production to sandbox
 * @param {Object} prodClient - axios client for production store
 * @param {Object} sandboxClient - axios client for sandbox store
 * @param {Number} brandId - brand id in production store
 * @param {Object} cache - simple cache to avoid duplicate API calls
 * @returns {Number} brandId in sandbox store
 */
export async function syncBrand(prodClient, sandboxClient, brandId, cache) {
  if (!brandId) return null;
  if (cache[brandId]) return cache[brandId];

  // Get brand from production
  const { data: prodData } = await prodClient.get(`/catalog/brands/${brandId}`);
  const prodBrand = prodData.data;

  // Check if exists in sandbox by name
  const { data: searchData } = await sandboxClient.get(
    `/catalog/brands?name=${encodeURIComponent(prodBrand.name)}`
  );

  if (searchData.data.length > 0) {
    cache[brandId] = searchData.data[0].id;
    return searchData.data[0].id;
  }

  // Create brand in sandbox
  const { data: created } = await sandboxClient.post(`/catalog/brands`, {
    name: prodBrand.name,
    is_visible: prodBrand.is_visible,
    page_title: prodBrand.page_title,
    meta_keywords: prodBrand.meta_keywords,
    meta_description: prodBrand.meta_description,
    search_keywords: prodBrand.search_keywords,
    custom_url: prodBrand.custom_url
  });

  cache[brandId] = created.data.id;
  return created.data.id;
}
