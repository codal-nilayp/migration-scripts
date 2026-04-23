import { fetchAll } from "./pagination.js";

export async function syncMetafields(prodClient, sandboxClient, prodId, sandboxId, dryRun) {
  const metafields = await fetchAll(
    prodClient,
    `
    query ($id: ID!, $first: Int!, $after: String) {
      metafields(ownerId: $id, first: $first, after: $after) {
        edges { node { namespace key type value } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    ["metafields"],
    { id: prodId }
  );

  if (dryRun) return;

  // metafieldsSet in batches of 25
}
