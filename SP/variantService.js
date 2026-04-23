import { fetchAll } from "./pagination.js";
import { safeExecute } from "./utils.js";

const VARIANTS_QUERY = `
query ($id: ID!, $first: Int!, $after: String) {
  product(id: $id) {
    variants(first: $first, after: $after) {
      edges {
        node {
          id
          sku
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;

export async function syncVariants(prodClient, sandboxClient, prodId, sandboxId, dryRun) {
  const prodVariants = await fetchAll(
    prodClient,
    VARIANTS_QUERY,
    ["product", "variants"],
    { id: prodId }
  );

  const sandboxVariants = await fetchAll(
    sandboxClient,
    VARIANTS_QUERY,
    ["product", "variants"],
    { id: sandboxId }
  );

  const sandboxBySku = new Map(
    sandboxVariants.filter(v => v.sku).map(v => [v.sku, v])
  );

  for (const v of prodVariants) {
    await safeExecute(`Variant ${v.sku}`, async () => {
      if (dryRun) return;

      if (sandboxBySku.has(v.sku)) {
        // update
      } else {
        // create
      }
    });
  }
}
