import dotenv from "dotenv";
import { createClient } from "./shopifyClient.js";
import { runSync } from "./productService.js";

dotenv.config();

const prodClient = createClient({
  shop: process.env.PROD_SHOP,
  token: process.env.PROD_TOKEN,
  apiVersion: process.env.SHOPIFY_API_VERSION
});

const sandboxClient = createClient({
  shop: process.env.SANDBOX_SHOP,
  token: process.env.SANDBOX_TOKEN,
  apiVersion: process.env.SHOPIFY_API_VERSION
});

runSync(
  prodClient,
  sandboxClient,
  process.env.DRY_RUN === "true"
);
