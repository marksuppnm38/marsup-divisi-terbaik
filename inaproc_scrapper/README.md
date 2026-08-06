# INAPROC Seller Scraper

Scrapes an entire seller catalogue from `katalog.inaproc.id` via its GraphQL
API: paginates the full product list, fetches complete detail for every
product, downloads every product image, and exports one CSV with everything
(including local image paths).

## Requirements

- Node.js 18+ (uses the built-in `fetch`, no dependencies to install)

## Usage

```bash
node index.js
```

That's it — no `npm install` needed, there are zero external dependencies.

## Configuration

Edit `config.js` to change:

- `SELLER_ID` / `USERNAME` — which seller to scrape
- `PER_PAGE` — products per listing page (default 50)
- `CONCURRENCY` — how many products are processed in parallel (default 5)
- `RETRY_ATTEMPTS` / `RETRY_BASE_DELAY_MS` — retry behavior for failed
  requests/downloads

## Output

Everything is written to `./output/`:

```
output/
  products.csv          One row per product
  images/
    <product-slug>/
      01.jpg
      02.jpg
      ...
```

- Re-running the script is safe: existing images are not re-downloaded.
- If a product's detail fetch fails after all retries, it still gets a row
  in the CSV (built from the list-level data only, with 0 images) so
  nothing silently disappears from the export — check the terminal output
  for any `FAILED` lines and re-run if needed.

## CSV columns

`id, name, slug, username, seller_name, brand, category, category_type,
price_min, price_min_with_tax, price_max, price_max_with_tax,
default_price, default_price_with_tax, stock_availability,
stock_accumulation, unit_sold, rating_average, rating_count, tkdn_value,
tkdn_status, tkdn_number, sni_status, sni_certificate_number, sni_number,
labels, is_wholesale, is_pre_order, variant_count, created_at, updated_at,
product_url, image_count, image_local_paths, description,
product_informations_json, variants_json, shipping_json,
prices_detail_json, seller_location_json`

The `*_json` columns hold richer nested data (full spec fields, per-variant
pricing/stock, shipping dimensions, region pricing) as JSON strings, so
nothing from the API response is thrown away even though the top-level
columns stay flat.

### Note on "set" / bundle products

Some listings (e.g. service/consolidated items, or multi-piece sets like
"ABN Vena Sectio Set") only show their full contents across several
photos rather than in structured fields — and some of those photos live
on individual **variants**, not in the product's main image gallery.

The scraper pulls images from both places:
- `images[]` — the main product gallery → saved as `01-main.jpg`, `02-main.jpg`, ...
- `variants[].imageUrl` — per-variant/configuration photos → saved as
  `03-variant_<sku>.jpg`, etc.

URLs that appear in both places (a variant reusing the main photo) are
only downloaded once. The `image_sources` CSV column lists where each
downloaded file came from, in the same order as `image_local_paths`, so
you can match filenames back to "main photo" vs. "this specific
variant/configuration".
