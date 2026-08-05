#!/usr/bin/env python3
"""
Scraper -> Cleaning pipeline for products.csv

STEP 1 (this file, section A): RECONSTRUCT
    The source products.csv was exported by the scraper with a structural bug:
    a couple of the scraped fields (`description` and `product_informations_json`)
    were built by joining list items with "; " *before* being written into a
    semicolon-delimited CSV, and were never quote-escaped. Because the CSV
    delimiter is also ";", every embedded "; " in those fields silently exploded
    a single logical row into many extra columns (and sometimes extra physical
    lines, when the joined text itself contained raw newlines).
    This section undoes that damage record-by-record before any cleaning happens.

STEP 2 (section B): CLEAN
    Once every record is a proper, fixed-width row again, we apply the requested
    cleaning/normalization rules and flatten the remaining nested JSON
    (variants, shipping, prices_detail, seller_location, product_informations)
    into readable columns.

Outputs:
    products_raw.csv    - flattened (record boundaries fixed) but otherwise UNTOUCHED values
    products_clean.csv  - fully cleaned, typed, normalized, analytics-ready values
"""
import csv
import html
import json
import re
import sys
from datetime import datetime

SRC = "/mnt/user-data/uploads/products.csv"
RAW_OUT = "/home/claude/products_raw.csv"
CLEAN_OUT = "/home/claude/products_clean.csv"

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)

# Header fields 0-25 are reliably positioned in the very first physical row
# of every record (id ... labels). Fields 26-33 are also positional
# (is_wholesale ... image_local_paths). Everything from 34 onward may be
# exploded across extra columns/rows and needs reconstruction.
BASE_FIELDS = [
    "id", "name", "slug", "seller_username", "seller_name", "brand",
    "category", "category_type", "price_min", "price_min_with_tax",
    "price_max", "price_max_with_tax", "default_price",
    "default_price_with_tax", "stock_availability", "stock_accumulation",
    "unit_sold", "rating_average", "rating_count", "tkdn_value",
    "tkdn_status", "tkdn_number", "sni_status", "sni_certificate_number",
    "sni_number", "labels",
]
DIRECT_TAIL_FIELDS = [
    "is_wholesale", "is_pre_order", "variant_count", "created_at",
    "updated_at", "product_url", "image_count", "image_local_paths",
]

stats = {
    "records": 0,
    "product_informations_recovered_json": 0,
    "product_informations_fallback_text": 0,
    "variants_json_recovered": 0,
    "shipping_json_recovered": 0,
    "prices_detail_json_recovered": 0,
    "seller_location_json_recovered": 0,
    "duplicates_removed": 0,
}


def read_raw_rows(path):
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        return list(reader)


NUM_DECLARED_COLUMNS = 40  # id ... seller_location_json


def _rstrip_row(row, floor=0):
    """Drop a row's own trailing empty/whitespace-only cells, never going
    below `floor` cells. The source header has ~55 phantom trailing columns
    (itself a symptom of the same exploded-row bug on the header line), so
    every physical row is padded out to that width; we strip that off
    per-physical-row (not once at the very end of a whole record) so it
    doesn't land in the middle of a multi-line record."""
    row = list(row)
    while len(row) > floor and row[-1].strip() in ("", "\t", "\t\t"):
        row.pop()
    return row


def group_records(rows):
    """Group physical CSV rows into logical records using the UUID at
    field[0] as the record-start marker.

    The first physical row of a record always has (at least) the 40
    declared columns positionally intact -- even the empty ones -- so it is
    only trimmed down to that floor of 40 (removing the header's phantom
    padding beyond it). Any further physical rows belong to a value that
    overflowed onto extra lines (e.g. a multi-line JSON/description field)
    and are appended in full, each with its own trailing padding stripped."""
    start_idx = [i for i, r in enumerate(rows) if r and UUID_RE.match(r[0])]
    records = []
    for n, idx in enumerate(start_idx):
        end = start_idx[n + 1] if n + 1 < len(start_idx) else len(rows)
        span = rows[idx:end]
        flat = list(_rstrip_row(span[0], floor=NUM_DECLARED_COLUMNS))
        for r in span[1:]:
            flat.extend(_rstrip_row(r, floor=0))
        records.append(flat)
    return records


def unescape_doubled_quotes(s):
    return s.replace('""', '"')


def try_json(s):
    """Try to parse a fragment as standalone JSON, cleaning up the
    double-doubled quotes the source file's broken escaping left behind."""
    if not s:
        return None
    candidate = s.strip()
    if not candidate or candidate[0] not in "{[":
        return None
    for attempt in (candidate, unescape_doubled_quotes(candidate)):
        try:
            return json.loads(attempt)
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def recover_trailing_json_fields(remainder):
    """The last up-to-4 real columns are variants_json, shipping_json,
    prices_detail_json, seller_location_json. Unlike description/
    product_informations, these were written as valid, properly quoted
    JSON, so we can recognise them by successfully parsing from the end."""
    recovered = []
    i = len(remainder) - 1
    while i >= 0 and len(recovered) < 4:
        parsed = try_json(remainder[i])
        if parsed is None:
            break
        recovered.append(parsed)
        i -= 1
    recovered.reverse()  # now in file order
    # pad on the left with None so recovered aligns to
    # [variants, shipping, prices_detail, seller_location]
    while len(recovered) < 4:
        recovered.insert(0, None)
    consumed_from = i + 1
    return recovered, remainder[:consumed_from]


INFO_START_RE = re.compile(r'^\{""?additionalInformations')


def split_description_and_informations(fragments):
    """`fragments` is everything between image_local_paths and the trailing
    JSON block: a mix of plain description text pieces and (if present) the
    exploded product_informations_json pieces, in original order."""
    split_at = None
    for i, frag in enumerate(fragments):
        if INFO_START_RE.match(frag.strip()):
            split_at = i
            break
    if split_at is None:
        return fragments, []
    return fragments[:split_at], fragments[split_at:]


NAME_VALUE_RE = re.compile(
    r'"?name"?\s*:\s*"(?P<name>.*?)"\s*,?\s*"?value"?\s*:\s*"(?P<value>.*?)"\s*[,}]',
    re.DOTALL,
)


def recover_product_informations(info_fragments):
    """The exploded fragments are unrecoverable as exact JSON (the scraper's
    "; "-join collapsed BOTH the JSON's real commas and any literal
    semicolons that happened to be inside a value, and that ambiguity can't
    be undone). Two-step best effort instead:
      1) try to rejoin with ',' and parse as JSON outright (works when no
         value happened to contain a stray comma/semicolon of its own).
      2) otherwise, regex out every ("name": ..., "value": ...) pair in
         document order -- order and content of the name/value pairs
         themselves is preserved even though the surrounding object/array
         punctuation is not, so this recovers the readable spec sheet
         (e.g. "Jenis Produk: IMPORT") even when full JSON can't be rebuilt.
    """
    if not info_fragments:
        return None, ""
    rejoined = ",".join(info_fragments)
    rejoined = unescape_doubled_quotes(rejoined).strip().strip('"')
    try:
        parsed = json.loads(rejoined)
        return parsed, ""
    except (json.JSONDecodeError, ValueError):
        pass

    pairs = NAME_VALUE_RE.findall(rejoined)
    if pairs:
        fallback_text = "; ".join(
            f"{name.strip()}: {value.strip()}" if name.strip() else value.strip()
            for name, value in pairs
            if name.strip() or value.strip()
        )
        return None, fallback_text

    # last resort: raw fragments joined for readability
    fallback_text = "; ".join(f.strip().strip('"') for f in info_fragments if f.strip())
    return None, fallback_text


def flatten_product_informations(parsed):
    """Turn {additionalInformations, documents, mainInformations} arrays of
    {name, value} into one readable 'Name: Value; Name2: Value2' string."""
    if not parsed:
        return ""
    parts = []
    for section in ("mainInformations", "additionalInformations", "documents"):
        items = parsed.get(section) if isinstance(parsed, dict) else None
        if not items:
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip()
            value = (item.get("value") or "").strip()
            if name or value:
                parts.append(f"{name}: {value}" if name else value)
    return "; ".join(parts)


def build_record_dict(flat):
    """Turn one flattened/reconstructed record into a raw field dict."""
    base = flat[:26] + [""] * max(0, 26 - len(flat))
    tail_direct = flat[26:34] + [""] * max(0, 34 - min(len(flat), 34))
    remainder = flat[34:]

    trailing_json, remainder_after_json = recover_trailing_json_fields(remainder)
    variants_json, shipping_json, prices_detail_json, seller_location_json = trailing_json

    desc_fragments, info_fragments = split_description_and_informations(remainder_after_json)
    description = "; ".join(f.strip().strip('"') for f in desc_fragments if f.strip())

    info_parsed, info_fallback_text = recover_product_informations(info_fragments)

    d = dict(zip(BASE_FIELDS, base))
    d.update(dict(zip(DIRECT_TAIL_FIELDS, tail_direct)))
    d["description"] = description
    d["product_informations"] = (
        flatten_product_informations(info_parsed) if info_parsed else info_fallback_text
    )
    d["_variants_json"] = variants_json
    d["_shipping_json"] = shipping_json
    d["_prices_detail_json"] = prices_detail_json
    d["_seller_location_json"] = seller_location_json

    if info_parsed:
        stats["product_informations_recovered_json"] += 1
    elif info_fallback_text:
        stats["product_informations_fallback_text"] += 1
    if variants_json is not None:
        stats["variants_json_recovered"] += 1
    if shipping_json is not None:
        stats["shipping_json_recovered"] += 1
    if prices_detail_json is not None:
        stats["prices_detail_json_recovered"] += 1
    if seller_location_json is not None:
        stats["seller_location_json_recovered"] += 1

    return d


def main_parse():
    rows = read_raw_rows(SRC)
    records = group_records(rows[1:])  # skip header
    stats["records"] = len(records)
    return [build_record_dict(flat) for flat in records]


# ---------------------------------------------------------------------------
# SECTION B: CLEANING
# ---------------------------------------------------------------------------

CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
TAG_RE = re.compile(r"<[^>]+>")
MULTI_SPACE_RE = re.compile(r"[ \t]+")
NEWLINE_RE = re.compile(r"\r\n|\r|\n")
NULLISH = {"", "-", "null", "undefined", "none", "n/a", "na", "nan"}
IMAGE_SPLIT_RE = re.compile(r"[;,]")


def clean_text(value, strip_html=False):
    """Trim, collapse whitespace/newlines, strip control chars, decode HTML
    entities, optionally remove tags, normalize null-ish placeholders."""
    if value is None:
        return ""
    s = str(value)
    s = html.unescape(s)
    if strip_html:
        s = TAG_RE.sub(" ", s)
    s = NEWLINE_RE.sub(" ", s)
    s = CONTROL_CHAR_RE.sub("", s)
    s = MULTI_SPACE_RE.sub(" ", s)
    s = s.strip()
    if s.lower() in NULLISH:
        return ""
    return s


def clean_number(value):
    """Strip currency symbols/commas/whitespace, return numeric string or ''."""
    s = clean_text(value)
    if not s:
        return ""
    s = re.sub(r"(?i)rp\.?|idr", "", s)
    s = s.replace(",", "").replace(" ", "")
    s = re.sub(r"[^\d.\-]", "", s)
    if s in ("", "-", "."):
        return ""
    try:
        f = float(s)
        return str(int(f)) if f.is_integer() else str(f)
    except ValueError:
        return ""


def clean_bool(value):
    s = clean_text(value).lower()
    if s in ("true", "1", "yes", "y"):
        return "TRUE"
    if s in ("false", "0", "no", "n"):
        return "FALSE"
    return ""


def clean_date(value):
    """Normalize a variety of date formats seen in the source into ISO-8601."""
    s = clean_text(value)
    if not s:
        return ""
    # e.g. "2024-03-01 22:09:30.64871 +0000 UTC"
    s2 = re.sub(r"\s*\+0000\s*UTC$", "", s)
    s2 = re.sub(r"Z$", "", s2)
    s2 = re.sub(r"T", " ", s2)
    # trim to seconds precision (drop sub-second fractions)
    s2 = re.sub(r"(\d{2}:\d{2}:\d{2})\.\d+", r"\1", s2)
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?", s2)
    if not m:
        return s  # leave as-is if unrecognized, rather than losing data
    date_part, time_part = m.group(1), m.group(2)
    try:
        datetime.strptime(date_part, "%Y-%m-%d")
    except ValueError:
        return s
    return f"{date_part} {time_part}" if time_part else date_part


def snake_case(name):
    s = re.sub(r"[^0-9a-zA-Z]+", "_", name)
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s)
    return s.strip("_").lower()


def split_images(local_paths_str):
    s = clean_text(local_paths_str)
    if not s:
        return []
    parts = [p.strip() for p in IMAGE_SPLIT_RE.split(s) if p.strip()]
    return parts


MAX_IMAGES = 5  # separate image path columns image_local_path_1..N


def flatten_shipping(obj):
    obj = obj or {}
    return {
        "shipping_weight": clean_number(obj.get("weight")),
        "shipping_weight_unit": clean_text(obj.get("weightUnit")),
        "shipping_length": clean_number(obj.get("length")),
        "shipping_width": clean_number(obj.get("width")),
        "shipping_height": clean_number(obj.get("height")),
        "shipping_dimension_unit": clean_text(obj.get("dimensionUnit")),
        "shipping_has_seller_shipping": clean_bool(obj.get("hasSellerShipping")),
    }


def flatten_prices_detail(obj):
    obj = obj or {}
    return {
        "prices_is_region_price": clean_bool(obj.get("isRegionPrice")),
        "prices_min_purchase": clean_number(obj.get("minPurchase")),
        "prices_min_price_with_tax": clean_number(obj.get("minPriceWithTax")),
        "prices_max_price": clean_number(obj.get("maxPrice")),
        "prices_max_price_with_tax": clean_number(obj.get("maxPriceWithTax")),
    }


def flatten_seller_location(obj):
    obj = obj or {}
    return {
        "seller_location_param_id": clean_text(obj.get("paramId")),
        "seller_location_city_name": clean_text(obj.get("cityName")),
        "seller_location_is_ftz": clean_bool(obj.get("isFTZ")),
    }


def flatten_variants(variants):
    variants = variants or []
    prices, stocks, skus = [], [], []
    for v in variants:
        if not isinstance(v, dict):
            continue
        if v.get("price") is not None:
            try:
                prices.append(float(v["price"]))
            except (TypeError, ValueError):
                pass
        if v.get("stock") is not None:
            try:
                stocks.append(int(v["stock"]))
            except (TypeError, ValueError):
                pass
        sku = clean_text(v.get("sku"))
        if sku:
            skus.append(sku)
    return {
        "variant_count_actual": str(len(variants)),
        "variant_min_price": clean_number(min(prices)) if prices else "",
        "variant_max_price": clean_number(max(prices)) if prices else "",
        "variant_total_stock": str(sum(stocks)) if stocks else "",
        "variant_skus": "; ".join(skus),
    }


CLEAN_COLUMNS = [
    "id", "name", "slug", "seller_username", "seller_name", "brand",
    "category", "category_type",
    "price_min", "price_min_with_tax", "price_max", "price_max_with_tax",
    "default_price", "default_price_with_tax",
    "stock_availability", "stock_accumulation", "unit_sold",
    "rating_average", "rating_count",
    "tkdn_value", "tkdn_status", "tkdn_number",
    "sni_status", "sni_certificate_number", "sni_number",
    "labels", "is_wholesale", "is_pre_order",
    "variant_count", "variant_count_actual",
    "variant_min_price", "variant_max_price", "variant_total_stock", "variant_skus",
    "created_at", "updated_at", "product_url",
    "image_count",
] + [f"image_local_path_{i}" for i in range(1, MAX_IMAGES + 1)] + [
    "description", "product_informations",
    "shipping_weight", "shipping_weight_unit", "shipping_length",
    "shipping_width", "shipping_height", "shipping_dimension_unit",
    "shipping_has_seller_shipping",
    "prices_is_region_price", "prices_min_purchase",
    "prices_min_price_with_tax", "prices_max_price", "prices_max_price_with_tax",
    "seller_location_param_id", "seller_location_city_name", "seller_location_is_ftz",
]


def clean_record(raw):
    out = {}
    out["id"] = clean_text(raw["id"])
    out["name"] = clean_text(raw["name"])
    out["slug"] = clean_text(raw["slug"])
    out["seller_username"] = clean_text(raw["seller_username"])
    out["seller_name"] = clean_text(raw["seller_name"])
    out["brand"] = clean_text(raw["brand"])
    out["category"] = clean_text(raw["category"])
    out["category_type"] = clean_text(raw["category_type"])

    for f in ("price_min", "price_min_with_tax", "price_max", "price_max_with_tax",
              "default_price", "default_price_with_tax"):
        out[f] = clean_number(raw[f])

    out["stock_availability"] = clean_bool(raw["stock_availability"])
    out["stock_accumulation"] = clean_number(raw["stock_accumulation"])
    out["unit_sold"] = clean_number(raw["unit_sold"])
    out["rating_average"] = clean_number(raw["rating_average"])
    out["rating_count"] = clean_number(raw["rating_count"])
    out["tkdn_value"] = clean_number(raw["tkdn_value"])
    out["tkdn_status"] = clean_text(raw["tkdn_status"])
    out["tkdn_number"] = clean_text(raw["tkdn_number"])
    out["sni_status"] = clean_text(raw["sni_status"])
    out["sni_certificate_number"] = clean_text(raw["sni_certificate_number"])
    out["sni_number"] = clean_text(raw["sni_number"])
    out["labels"] = clean_text(raw["labels"])
    out["is_wholesale"] = clean_bool(raw["is_wholesale"])
    out["is_pre_order"] = clean_bool(raw["is_pre_order"])
    out["variant_count"] = clean_number(raw["variant_count"])
    out["created_at"] = clean_date(raw["created_at"])
    out["updated_at"] = clean_date(raw["updated_at"])
    out["product_url"] = clean_text(raw["product_url"])
    out["image_count"] = clean_number(raw["image_count"])

    images = split_images(raw["image_local_paths"])
    for i in range(MAX_IMAGES):
        out[f"image_local_path_{i+1}"] = images[i] if i < len(images) else ""

    out["description"] = clean_text(raw["description"], strip_html=True)
    out["product_informations"] = clean_text(raw["product_informations"])

    out.update(flatten_variants(raw["_variants_json"]))
    out.update(flatten_shipping(raw["_shipping_json"]))
    out.update(flatten_prices_detail(raw["_prices_detail_json"]))
    out.update(flatten_seller_location(raw["_seller_location_json"]))

    return out


RAW_COLUMNS = BASE_FIELDS + DIRECT_TAIL_FIELDS + [
    "description", "product_informations",
    "variants_json", "shipping_json", "prices_detail_json", "seller_location_json",
]


def raw_record_row(raw):
    row = {k: raw.get(k, "") for k in BASE_FIELDS + DIRECT_TAIL_FIELDS}
    row["description"] = raw["description"]
    row["product_informations"] = raw["product_informations"]
    row["variants_json"] = json.dumps(raw["_variants_json"], ensure_ascii=False) if raw["_variants_json"] is not None else ""
    row["shipping_json"] = json.dumps(raw["_shipping_json"], ensure_ascii=False) if raw["_shipping_json"] is not None else ""
    row["prices_detail_json"] = json.dumps(raw["_prices_detail_json"], ensure_ascii=False) if raw["_prices_detail_json"] is not None else ""
    row["seller_location_json"] = json.dumps(raw["_seller_location_json"], ensure_ascii=False) if raw["_seller_location_json"] is not None else ""
    return row


def write_csv(path, columns, rows):
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=columns, delimiter=",",
            quoting=csv.QUOTE_MINIMAL, quotechar='"', lineterminator="\n",
        )
        writer.writeheader()
        for r in rows:
            writer.writerow(r)


if __name__ == "__main__":
    recs = main_parse()
    total_lines = sum(1 for _ in open(SRC, encoding="utf-8"))
    print(f"Reconstructed {len(recs)} logical product records from "
          f"{total_lines} raw physical lines.")

    # RAW output: reconstructed/flattened, values otherwise untouched
    raw_rows = [raw_record_row(r) for r in recs]
    write_csv(RAW_OUT, RAW_COLUMNS, raw_rows)

    # CLEAN output
    clean_rows = [clean_record(r) for r in recs]

    # dedupe by id (keep first occurrence)
    seen = set()
    deduped = []
    for r in clean_rows:
        if r["id"] in seen:
            stats["duplicates_removed"] += 1
            continue
        seen.add(r["id"])
        deduped.append(r)

    # dedupe by (name, seller_username) too, in case of id-less repeats
    seen_ns = set()
    final_rows = []
    for r in deduped:
        key = (r["name"].lower(), r["seller_username"].lower())
        if key in seen_ns:
            stats["duplicates_removed"] += 1
            continue
        seen_ns.add(key)
        final_rows.append(r)

    final_rows.sort(key=lambda r: r["name"].lower())

    write_csv(CLEAN_OUT, CLEAN_COLUMNS, final_rows)

    print(f"\nWrote {len(raw_rows)} rows to {RAW_OUT}")
    print(f"Wrote {len(final_rows)} rows to {CLEAN_OUT} "
          f"({stats['duplicates_removed']} duplicate(s) removed)")
    print("\nRecovery stats:", stats)