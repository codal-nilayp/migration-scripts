export default async function safeExecute(fn, context = "",successMsg = "") {
    try {
      const result = await fn();

      if (successMsg) {
        console.log(`✅ ${successMsg}`);
      }
  
      return result;
    } catch (err) {
      console.error(`❌ Error in ${context}`);
      console.error(err?.response?.data || err.message);
      return null;
    }
}

export function mergeCustomFieldsForUpdate(existing = [], incoming = []) {
    const merged = [...existing];
    for (const f of incoming) {
      const match = merged.find(e => e.name === f.name);
      if (match) match.value = f.value;
      else merged.push({ name: f.name, value: f.value });
    }
    return merged;
  }
  
export function mergeVariants(existing = [], incoming = []) {
    const merged = [...existing];
  
    for (const pv of incoming) {
      let match = existing.find(ev => ev.sku === pv.sku);
  
      if (!match && pv.option_values) {
        match = existing.find(ev =>
          JSON.stringify(ev.option_values) === JSON.stringify(pv.option_values)
        );
      }
  
      if (match) {
        Object.assign(match, {
          price: pv.price,
          sale_price: pv.sale_price,
          sku: pv.sku,
          inventory_level: pv.inventory_level,
          weight: pv.weight
        });
      } else {
        const v = { ...pv };
        delete v.id;
        merged.push(v);
      }
    }
    return merged;
  }