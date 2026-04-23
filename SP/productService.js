import { fetchAll } from "./pagination.js";
import { resumeStore, safeExecute } from "./utils.js";
import { syncVariants } from "./variantService.js";
import { syncMedia } from "./mediaService.js";
import { syncMetafields } from "./metafieldService.js";

export async function runSync(prodClient, sandboxClient, dryRun) {
  const resume = resumeStore.load();
  let skip = !!resume;

  const products = await fetchAll(
    prodClient,
    `
    query ($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        edges { node { id title handle } }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    ["products"]
  );

  for (const p of products) {
    if (skip) {
      if (p.handle === resume.lastHandle) skip = false;
      continue;
    }

    console.log(`\n🔄 ${p.title}`);

    await safeExecute("Product sync", async () => {
      const sandboxId = "CREATE_OR_FETCH_PRODUCT_ID";

      await syncVariants(prodClient, sandboxClient, p.id, sandboxId, dryRun);
      await syncMedia(prodClient, sandboxClient, p.id, sandboxId, dryRun);
      await syncMetafields(prodClient, sandboxClient, p.id, sandboxId, dryRun);

      resumeStore.save(p.handle);
    });

    console.log(`✅ Done ${p.title}`);
  }
}
