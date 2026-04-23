const axios = require('axios');

// ====== CONFIGURATION ======
const PROD_STORE = 'nilay-dev.myshopify.com';
const PROD_TOKEN = 'shpat_xxx';

const SANDBOX_STORE = 'nilay-test-plus.myshopify.com';
const SANDBOX_TOKEN = 'shpat_xxx';

const PROD_API = `https://${PROD_STORE}/admin/api/2026-01`;
const SANDBOX_API = `https://${SANDBOX_STORE}/admin/api/2026-01`;

// ====== HELPER FUNCTIONS ======
async function getAllProducts() {
  let products = [];
  let pageInfo = null;

  try {
    do {
      const url = `${PROD_API}/products.json?limit=250${pageInfo ? `&page_info=${pageInfo}` : ''}`;
      const res = await axios.get(url, { headers: { 'X-Shopify-Access-Token': PROD_TOKEN } });

      products = products.concat(res.data.products);

      // Pagination
      const linkHeader = res.headers.link;
      if (linkHeader && linkHeader.includes('rel="next"')) {
        pageInfo = new URLSearchParams(linkHeader.split(';')[0].slice(1, -1)).get('page_info');
      } else {
        pageInfo = null;
      }
    } while (pageInfo);

    return products;
  } catch (err) {
    console.error('Error fetching products:', err.response?.data || err.message);
    return [];
  }
}

async function getProductMetafields(productId) {
  try {
    const res = await axios.get(`${PROD_API}/products/${productId}/metafields.json`, {
      headers: { 'X-Shopify-Access-Token': PROD_TOKEN },
    });
    return res.data.metafields || [];
  } catch (err) {
    console.error(`Error fetching metafields for product ${productId}:`, err.message);
    return [];
  }
}

async function getProductImages(productId) {
  try {
    const res = await axios.get(`${PROD_API}/products/${productId}/images.json`, {
      headers: { 'X-Shopify-Access-Token': PROD_TOKEN },
    });
    return res.data.images || [];
  } catch (err) {
    console.error(`Error fetching images for product ${productId}:`, err.message);
    return [];
  }
}

async function getCollections() {
  try {
    const res = await axios.get(`${SANDBOX_API}/custom_collections.json`, {
      headers: { 'X-Shopify-Access-Token': SANDBOX_TOKEN },
    });
    return res.data.custom_collections || [];
  } catch (err) {
    console.error('Error fetching collections:', err.message);
    return [];
  }
}

async function createCollectionIfNotExists(title) {
  const collections = await getCollections();
  const existing = collections.find(c => c.title === title);
  if (existing) return existing.id;

  try {
    const res = await axios.post(
      `${SANDBOX_API}/custom_collections.json`,
      { custom_collection: { title } },
      { headers: { 'X-Shopify-Access-Token': SANDBOX_TOKEN } }
    );
    return res.data.custom_collection.id;
  } catch (err) {
    console.error(`Error creating collection "${title}":`, err.message);
    return null;
  }
}

// ====== CREATE PRODUCT IN SANDBOX ======
async function createProductInSandbox(product) {
  try {
    const images = await getProductImages(product.id);
    const metafields = await getProductMetafields(product.id);

    // Map product options dynamically
    const options = (product.options || []).map(opt => ({
      name: opt.name,
      values: opt.values,
    }));

    // Map variants dynamically including images
    const variants = (product.variants || []).map(v => {
      const variantData = {
        price: v.price,
        compare_at_price: v.compare_at_price,
        sku: v.sku,
        barcode: v.barcode,
        inventory_quantity: v.inventory_quantity,
        weight: v.weight,
        weight_unit: v.weight_unit,
        fulfillment_service: v.fulfillment_service,
      };

      // Dynamically assign option values
      product.options.forEach((opt, index) => {
        const optionKey = `option${index + 1}`;
        variantData[optionKey] = v[optionKey];
      });

      // Map variant image if exists
      if (v.image_id) {
        const variantImage = images.find(img => img.id === v.image_id);
        if (variantImage) {
          variantData.image = { src: variantImage.src, alt: variantImage.alt };
        }
      }

      return variantData;
    });
    console.log(variants);
    // Map collections
    const collectionIds = [];
    if (product.product_type) {
      const collectionId = await createCollectionIfNotExists(product.product_type);
      if (collectionId) collectionIds.push(collectionId);
    }

    const newProductData = {
      product: {
        title: product.title,
        body_html: product.body_html,
        vendor: product.vendor,
        product_type: product.product_type,
        tags: product.tags,
        options,
        variants,
        images,          // product images
        metafields,
        handle: product.handle,
        published: product.published_at ? true : false,
        status: product.status,
      },
    };

    const res = await axios.post(`${SANDBOX_API}/products.json`, newProductData, {
      headers: { 'X-Shopify-Access-Token': SANDBOX_TOKEN },
    });

    console.log(`✅ Product "${product.title}" created with variant images`);
    return res.data.product.id;
  } catch (err) {
    console.error(`Error creating product "${product.title}" in sandbox:`, err.response?.data || err.message);
    return null;
  }
}

// ====== MAIN SCRIPT ======
(async () => {
  const products = await getAllProducts();
  console.log(`Fetched ${products.length} products from production`);

  for (const product of products) {
    await createProductInSandbox(product);
    return ;
  }

  console.log('✅ Product migration completed with variant images.');
})();
