import { fetchAll } from "./pagination.js";
import { sleep, safeExecute } from "./utils.js";

export async function waitForMediaReady(client, mediaId) {
  while (true) {
    const q = `
    query ($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          status
        }
      }
    }`;
    const r = await client(q, { id: mediaId });
    if (r.node.status === "READY") return;
    await sleep(2000);
  }
}

export async function syncMedia(prodClient, sandboxClient, prodId, sandboxId, dryRun) {
  const media = await fetchAll(
    prodClient,
    `
    query ($id: ID!, $first: Int!, $after: String) {
      product(id: $id) {
        media(first: $first, after: $after) {
          edges {
            node {
              ... on MediaImage {
                image { url }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    ["product", "media"],
    { id: prodId }
  );

  for (const m of media) {
    await safeExecute("Media upload", async () => {
      if (dryRun) return;
      // productCreateMedia → waitForMediaReady → map source URL
    });
  }
}
