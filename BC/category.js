export default async function syncCategory(prodClient, sandboxClient, categoryId, cache) {
    if (!categoryId) return null;
    if (cache[categoryId]) return cache[categoryId];
  
    const prodRes = await prodClient.get(`/catalog/categories/${categoryId}`);
    const prodCategory = prodRes.data.data;
  
    const search = await sandboxClient.get(
      `/catalog/categories?name=${encodeURIComponent(prodCategory.name)}`
    );
  
    if (search.data.data.length) {
      cache[categoryId] = search.data.data[0].id;
      return cache[categoryId];
    }
  
    const created = await sandboxClient.post(`/catalog/categories`, {
      name: prodCategory.name,
      parent_id: prodCategory.parent_id
        ? await syncCategory(prodClient, sandboxClient, prodCategory.parent_id, cache)
        : 0,
      is_visible: prodCategory.is_visible,
      description: prodCategory.description
    });
  
    cache[categoryId] = created.data.data.id;
    return cache[categoryId];
  }