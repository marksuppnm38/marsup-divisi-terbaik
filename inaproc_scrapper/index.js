"use strict";

const fs = require("fs");
const path = require("path");

const config = require("./config");
const { graphqlRequest } = require("./lib/graphqlClient");
const { SEARCH_PRODUCTS_QUERY, GET_PRODUCT_BY_SLUG_QUERY } = require("./lib/queries");
const { downloadImage } = require("./lib/imageDownloader");
const { CsvWriter } = require("./lib/csvWriter");
const { runPool } = require("./lib/pool");

const CSV_COLUMNS = [
  "id",
  "name",
  "slug",
  "username",
  "seller_name",
  "brand",
  "category",
  "category_type",
  "price_min",
  "price_min_with_tax",
  "price_max",
  "price_max_with_tax",
  "default_price",
  "default_price_with_tax",
  "stock_availability",
  "stock_accumulation",
  "unit_sold",
  "rating_average",
  "rating_count",
  "tkdn_value",
  "tkdn_status",
  "tkdn_number",
  "sni_status",
  "sni_certificate_number",
  "sni_number",
  "labels",
  "is_wholesale",
  "is_pre_order",
  "variant_count",
  "created_at",
  "updated_at",
  "product_url",
  "image_count",
  "image_local_paths",
  "image_sources",
  "description",
  "product_informations_json",
  "variants_json",
  "shipping_json",
  "prices_detail_json",
  "seller_location_json",
];

/** Fetches every page of the seller catalogue via searchProducts. */
async function fetchAllListItems() {
  const items = [];
  let page = 1;
  let lastPage = 1;

  do {
    const variables = {
      input: {
        sort: [{ field: "CREATED_AT", order: "DESC" }],
        filter: {
          strategy: "SELLER_CATALOGUE",
          keyword: null,
          sellerId: config.SELLER_ID,
        },
        pagination: { page, perPage: config.PER_PAGE },
      },
    };

    const data = await graphqlRequest(
      "searchProducts",
      SEARCH_PRODUCTS_QUERY,
      variables,
      `searchProducts page ${page}`
    );

    const result = data.searchProducts;
    if (!result || !Array.isArray(result.items)) {
      throw new Error(
        `searchProducts returned an error: ${result && result.message ? result.message : "unknown error"}`
      );
    }

    items.push(...result.items);
    lastPage = result.lastPage || 1;
    console.log(`  Listed page ${page}/${lastPage} (${result.items.length} products, ${items.length} total so far)`);
    page++;
  } while (page <= lastPage);

  return items;
}

/** Fetches full product detail for a single slug/username pair. */
async function fetchProductDetail(username, slug) {
  const variables = {
    _v0_username: username,
    _v0_slug: slug,
    _v0_regionCode: config.REGION_CODE,
    _v1_input: { sellerId: config.SELLER_ID },
  };

  const data = await graphqlRequest(
    "getProductBySlug",
    GET_PRODUCT_BY_SLUG_QUERY,
    variables,
    `getProductBySlug ${slug}`
  );

  const product = data._v0_getProductBySlug;
  if (!product || !product.slug) {
    throw new Error(
      `getProductBySlug returned an error: ${product && product.message ? product.message : "unknown error"}`
    );
  }
  return product;
}

/**
 * Gathers every distinct image URL for a product from two sources:
 *  - `images[]`   — the main product gallery
 *  - `variants[].imageUrl` — per-variant photos, which "Set"/bundle-style
 *    products often use to show each configuration separately and which
 *    do NOT appear in the main `images[]` array.
 * Dedupes by URL (variants frequently just reuse the main product photo)
 * while preserving first-seen order, and tags each entry with where it
 * came from so the downloaded filename and CSV both make that visible.
 */
function collectImageEntries(detail) {
  const seenUrls = new Set();
  const entries = [];

  for (const img of detail.images || []) {
    const url = img && img.imageUrl;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    entries.push({ url, source: "main" });
  }

  for (const variant of detail.variants || []) {
    const url = variant && variant.imageUrl;
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const variantLabel = variant.sku || (variant.optionValues || []).join("-") || variant.id || "variant";
    entries.push({ url, source: `variant:${variantLabel}` });
  }

  return entries;
}

/** Downloads every image for a product into output/images/<slug>/. */
async function downloadProductImages(slug, imageEntries) {
  const destDir = path.join(config.IMAGES_DIR, slug);
  const localPaths = [];
  const sources = [];

  for (let i = 0; i < imageEntries.length; i++) {
    const { url, source } = imageEntries[i];
    const safeSource = source.replace(/[^a-z0-9-]/gi, "_");
    const fileNameBase = `${String(i + 1).padStart(2, "0")}-${safeSource}`;
    const localPath = await downloadImage(url, destDir, fileNameBase, `${slug} image ${i + 1} (${source})`);
    if (localPath) {
      localPaths.push(path.relative(config.OUTPUT_DIR, localPath));
      sources.push(source);
    }
  }

  return { localPaths, sources };
}

function buildRow(listItem, detail, imageLocalPaths, imageSources = []) {
  const brand = (detail.brand && detail.brand.brandName) || (listItem.brand && listItem.brand.brandName) || "";
  const category = (detail.category && detail.category.name) || (listItem.category && listItem.category.name) || "";
  const labels = detail.labels || listItem.labels || [];
  const variants = detail.variants || listItem.variants || [];
  const rating = detail.rating || listItem.rating || {};
  const tkdn = detail.tkdn || listItem.tkdn || {};

  return {
    id: detail.id || listItem.id,
    name: detail.name || listItem.name,
    slug: listItem.slug,
    username: listItem.username,
    seller_name: listItem.sellerName,
    brand,
    category,
    category_type: detail.categoryType || "",
    price_min: listItem.minPrice,
    price_min_with_tax: listItem.minPriceWithTax,
    price_max: listItem.maxPrice,
    price_max_with_tax: listItem.maxPriceWithTax,
    default_price: listItem.defaultPrice,
    default_price_with_tax: listItem.defaultPriceWithTax,
    stock_availability: listItem.stockAvailability,
    stock_accumulation: listItem.stockAccumulation,
    unit_sold: detail.unitSold ?? listItem.unitSold,
    rating_average: rating.average,
    rating_count: rating.count,
    tkdn_value: tkdn.value,
    tkdn_status: tkdn.status,
    tkdn_number: detail.tkdn ? detail.tkdn.number : undefined,
    sni_status: detail.sni ? detail.sni.status : undefined,
    sni_certificate_number: detail.sni ? detail.sni.certificateNumber : undefined,
    sni_number: detail.sni ? detail.sni.sniNumber : undefined,
    labels: labels.join("; "),
    is_wholesale: listItem.isWholesale,
    is_pre_order: listItem.isPreOrder,
    variant_count: variants.length,
    created_at: listItem.createdAt,
    updated_at: detail.updatedAt,
    product_url: `https://katalog.inaproc.id/${listItem.username}/${listItem.slug}`,
    image_count: imageLocalPaths.length,
    image_local_paths: imageLocalPaths.join("; "),
    image_sources: imageSources.join("; "),
    description: detail.description,
    product_informations_json: detail.productInformations,
    variants_json: variants,
    shipping_json: detail.shipping,
    prices_detail_json: detail.prices,
    seller_location_json: detail.sellerLocation,
  };
}

async function main() {
  console.log(`INAPROC scraper — seller: ${config.USERNAME} (${config.SELLER_ID})\n`);

  fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });

  console.log("Step 1/3: Listing all products in the seller catalogue...");
  const listItems = await fetchAllListItems();
  console.log(`Done. Found ${listItems.length} products.\n`);

  console.log("Step 2/3: Fetching full detail + downloading images for each product...");
  const csv = new CsvWriter(config.CSV_PATH, CSV_COLUMNS);

  let done = 0;
  let failed = 0;

  await runPool(listItems, config.CONCURRENCY, async (listItem) => {
    const label = `${listItem.slug}`;
    try {
      const detail = await fetchProductDetail(listItem.username, listItem.slug);
      const imageEntries = collectImageEntries(detail);
      const { localPaths, sources } = await downloadProductImages(listItem.slug, imageEntries);
      const row = buildRow(listItem, detail, localPaths, sources);
      csv.writeRow(row);
      done++;
      console.log(`  [${done + failed}/${listItems.length}] OK: ${label} (${localPaths.length} images)`);
    } catch (err) {
      failed++;
      console.error(`  [${done + failed}/${listItems.length}] FAILED: ${label} — ${err.message}`);
      // Still write a partial row so the product isn't silently missing from the CSV.
      csv.writeRow(buildRow(listItem, {}, []));
    }
  });

  await csv.close();

  console.log(`\nStep 3/3: Done.`);
  console.log(`  Products succeeded (full detail + images): ${done}`);
  console.log(`  Products failed (list data only, in CSV):  ${failed}`);
  console.log(`  CSV:    ${config.CSV_PATH}`);
  console.log(`  Images: ${config.IMAGES_DIR}`);
}

main().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
