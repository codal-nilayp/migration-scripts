import fetch from "node-fetch";
import { sleep } from "./utils.js";

export function createClient({ shop, token, apiVersion }) {
  return async function graphql(query, variables = {}) {
    const res = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token
        },
        body: JSON.stringify({ query, variables })
      }
    );

    const cost = res.headers.get("x-shopify-shop-api-call-limit");

    if (cost) {
      const [used, max] = cost.split("/").map(Number);
      if (used / max > 0.8) {
        console.log("⏳ Rate limit high, backing off...");
        await sleep(1500);
      }
    }

    const json = await res.json();
    if (json.errors) throw json.errors;
    return json.data;
  };
}
