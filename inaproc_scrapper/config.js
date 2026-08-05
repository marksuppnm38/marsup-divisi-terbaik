"use strict";

const path = require("path");

module.exports = {
  // Target seller
  SELLER_ID: "01JJTFB2E9HHVVRHB9G6MZYFYY",
  USERNAME: "abadinusa-usahasemesta",

  // Used for the `prices(regionCode: ...)` field on getProductBySlug.
  // Doesn't need to be "correct" for your buyer region — it just needs to be
  // a valid region code so the query returns a price. Jakarta Pusat is fine
  // as a fixed default for comparison purposes.
  REGION_CODE: "31.71",

  GRAPHQL_ENDPOINT: "https://katalog.inaproc.id/graphql",

  // searchProducts pagination
  PER_PAGE: 50,

  // How many products to fetch detail + download images for concurrently
  CONCURRENCY: 5,

  // Retry behavior for every network call (GraphQL + image downloads)
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_DELAY_MS: 600,

  // Output locations
  OUTPUT_DIR: path.join(__dirname, "output"),
  IMAGES_DIR: path.join(__dirname, "output", "images"),
  CSV_PATH: path.join(__dirname, "output", "products.csv"),
};
