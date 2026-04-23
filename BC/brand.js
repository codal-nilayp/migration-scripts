export default async function syncBrand(prodClient, sandboxClient, brandId, cache) {
    if (!brandId) return null;
    if (cache[brandId]) return cache[brandId];
  
    const prodBrand = (await prodClient.get(`/catalog/brands/${brandId}`)).data.data;
  
    const search = await sandboxClient.get(
      `/catalog/brands?name=${encodeURIComponent(prodBrand.name)}`
    );
  
    if (search.data.data.length) {
      cache[brandId] = search.data.data[0].id;
      return cache[brandId];
    }
  
    const created = await sandboxClient.post(`/catalog/brands`, {
      name: prodBrand.name,
      is_visible: prodBrand.is_visible,
      meta_description: prodBrand.meta_description,
      search_keywords: prodBrand.search_keywords,
      custom_url: prodBrand.custom_url
    });
  
    cache[brandId] = created.data.data.id;
    return cache[brandId];
  }