import safeExecute from './helper.js'
async function getProductModifiers(client, productId) {
    const res = await client.get(
      `/catalog/products/${productId}/modifiers`
    );
    return res.data.data || [];
  }
  function findModifier(existingModifiers, modifier) {
    return existingModifiers.find(
      m =>
        m.display_name === modifier.display_name &&
        m.type === modifier.type
    );
  }
function buildModifierPayload(modifier) {
    const payload = {
      type: modifier.type,
      display_name: modifier.display_name,
      required: modifier.required,
      sort_order: modifier.sort_order,
      config: modifier.config
    };
  
    // ❗ Checkbox modifiers must NOT include option_values
    if (modifier.type !== "checkbox") {
      payload.option_values = modifier.option_values?.map(o => ({
        label: o.label,
        sort_order: o.sort_order,
        is_default: o.is_default,
        adjusters: o.adjusters
      }));
    }
  
    return payload;
}
async function createModifier(client, productId, modifier) {
    const payload = buildModifierPayload(modifier);
  
    return client.post(
      `/catalog/products/${productId}/modifiers`,
      payload
    );
}
async function updateModifier(client, productId, modifierId, modifier) {
    const payload = buildModifierPayload(modifier);
  
    return client.put(
      `/catalog/products/${productId}/modifiers/${modifierId}`,
      payload
    );
}
export default async function syncModifiers(
    prodClient,
    sandboxClient,
    prodProductId,
    sandboxProductId
  ) {
    const prodModifiers = await getProductModifiers(
      prodClient,
      prodProductId
    );
    if (!prodModifiers.length) return;
  
    const sandboxModifiers = await getProductModifiers(
      sandboxClient,
      sandboxProductId
    );
  
    for (const prodModifier of prodModifiers) {
      const existing = findModifier(sandboxModifiers, prodModifier);
  
      if (existing) {
  
        await safeExecute(
          () =>
            updateModifier(
              sandboxClient,
              sandboxProductId,
              existing.id,
              prodModifier
            ),
          `updateModifier (${prodModifier.display_name})`,
          "Modified Updated"
        );
      } else {
  
        await safeExecute(
          () =>
            createModifier(
              sandboxClient,
              sandboxProductId,
              prodModifier
            ),
          `createModifier (${prodModifier.display_name})`,
          "Modified Created"
        );
      }
    }
}