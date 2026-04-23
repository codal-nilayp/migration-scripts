import safeExecute, { mergeCustomFieldsForUpdate, mergeVariants} from './helper.js'
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
export async function getProductImages(client, productId) {
    const res = await client.get(
      `/catalog/products/${productId}/images`
    );
    return res.data.data || [];
}
export async function deleteAllProductImages(client, productId) {
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
export async function createProductImages(client, productId, images = []) {
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