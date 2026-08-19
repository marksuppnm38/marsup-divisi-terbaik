(async () => {
  const BASE = "https://katalog.inaproc.id";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rid = () => Math.random().toString(36).slice(2);

  // ====================================================================
  // GANTI DI SINI: daftar username toko yang mau di-scrape pricelist-nya
  // (username = slug di URL toko, contoh: katalog.inaproc.id/zoi-medisains-indonesia
  //  -> username-nya "zoi-medisains-indonesia")
  // ====================================================================
  const SELLER_USERNAMES = [
    "zoi-medisains-indonesia"
    // tambah baris lain di sini kalau mau sekalian, contoh:
    // "nama-toko-lain",
  ];

  // sellerId yang SUDAH DIKONFIRMASI (dari network tab / curl kamu) -- ini dipakai duluan,
  // gak perlu resolve lagi. Kalau kosong utk suatu username, script bakal coba resolve otomatis.
  const SELLER_ID_OVERRIDE = {
    "zoi-medisains-indonesia": "01JFCDTYP7QMSX6200WZP5TCYS"
  };
  // ====================================================================

  // ---------- reuse dari script sebelumnya: parser RSC + deep key finder ----------
  function parseRSCChunks(text) {
    const chunks = [];
    for (const line of text.split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const rest = line.slice(idx + 1);
      try {
        chunks.push(JSON.parse(rest));
      } catch (e) {
        // bukan JSON valid, skip
      }
    }
    return chunks;
  }

  function findKeyDeep(obj, targetKey, seen = new Set()) {
    if (obj === null || typeof obj !== "object") return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (!Array.isArray(obj) && Object.prototype.hasOwnProperty.call(obj, targetKey)) {
      return obj[targetKey];
    }
    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of values) {
      const found = findKeyDeep(v, targetKey, seen);
      if (found !== null && found !== undefined) return found;
    }
    return null;
  }

  // Cari object yg punya field username PERSIS sama + field id di sebelahnya
  // (dipakai buat resolve sellerId dari slug toko kalau belum ada di SELLER_ID_OVERRIDE)
  function findObjectByUsername(obj, username, seen = new Set()) {
    if (obj === null || typeof obj !== "object") return null;
    if (seen.has(obj)) return null;
    seen.add(obj);
    if (!Array.isArray(obj) && obj.username === username && obj.id) {
      return obj;
    }
    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of values) {
      const found = findObjectByUsername(v, username, seen);
      if (found) return found;
    }
    return null;
  }

  // ---------- best-effort: resolve sellerId dari halaman toko (belum 100% teruji, ada fallback) ----------
  async function resolveSellerId(username) {
    const url = `${BASE}/${username}?_rsc=${rid()}`;
    const res = await fetch(url, { headers: { rsc: "1", accept: "*/*" }, credentials: "include" });
    const raw = await res.text();
    const chunks = parseRSCChunks(raw);
    for (const c of chunks) {
      const found = findObjectByUsername(c, username);
      if (found) return found.id;
    }
    for (const c of chunks) {
      const found = findKeyDeep(c, "sellerId");
      if (found) return found;
    }
    return null;
  }

  // ---------- GraphQL searchProducts (persis dari network capture kamu) ----------
  const SEARCH_PRODUCTS_QUERY = `query searchProducts($input: SearchProductInput!) {
    searchProducts(input: $input) {
      ... on ListSearchProductResponse {
        total
        perPage
        currentPage
        lastPage
        items {
          id
          type
          isActive
          images
          isPreOrder
          isRegionPrice
          isSellerUMKK
          labels
          isWholesale
          defaultPrice
          defaultPriceWithTax
          createdAt
          maxPrice
          maxPriceWithTax
          minPrice
          minPriceWithTax
          ppnBmPercentage
          ppnPercentage
          tkdn {
            value
            bmpValue
            tkdnBmp
            status
          }
          location {
            name
            regionCode
          }
          name
          stockAvailability
          stockAccumulation
          sellerName
          sellerId
          unitSold
          username
          slug
          rating {
            count
            average
          }
          variants {
            id
            isActive
            options {
              name
              value
            }
            price
            priceWithTax
            sortOrder
            stock
          }
          status
          brand {
            brandName
            status
          }
          category {
            isActive
            name
            id
          }
        }
      }
      ... on GenericError {
        __typename
        reqId
        message
        code
      }
    }
  }`;

  async function fetchSellerCatalogPage(sellerId, page) {
    const body = {
      query: SEARCH_PRODUCTS_QUERY,
      variables: {
        input: {
          sort: [{ field: "CREATED_AT", order: "DESC" }],
          filter: { strategy: "SELLER_CATALOGUE", keyword: null, sellerId },
          pagination: { page, perPage: 20 }
        }
      },
      operationName: "searchProducts"
    };
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "*/*" },
      credentials: "include",
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[GraphQL] HTTP ${res.status} utk sellerId=${sellerId} page=${page}. Body: ${errText.slice(0, 300)}`);
      return null;
    }
    const json = await res.json();
    return json?.data?.searchProducts || null;
  }

  async function fetchSellerCatalog(sellerId, username) {
    let page = 1;
    let lastPage = 1;
    const items = [];
    do {
      const result = await fetchSellerCatalogPage(sellerId, page);
      if (!result || result.__typename === "GenericError" || result.code) {
        console.error(`Gagal ambil katalog toko "${username}" (sellerId=${sellerId}) halaman ${page}:`, result);
        break;
      }
      lastPage = result.lastPage || 1;
      items.push(...(result.items || []));
      page++;
      if (page <= lastPage) await sleep(200);
    } while (page <= lastPage);
    return items;
  }

  // ---------- main loop ----------
  const rows = [];
  const failedSellers = [];

  for (const username of SELLER_USERNAMES) {
    let sellerId = SELLER_ID_OVERRIDE[username];
    if (!sellerId) {
      console.log(`sellerId utk "${username}" belum ada di override, coba resolve otomatis dari halaman toko...`);
      sellerId = await resolveSellerId(username);
      await sleep(200);
    }
    if (!sellerId) {
      console.error(`Gagal dapetin sellerId utk "${username}". Cara manual: buka https://katalog.inaproc.id/${username} di tab baru, buka DevTools > Network > filter "graphql", cari request "searchProducts", lihat "sellerId" di Payload-nya, terus tambahin ke SELLER_ID_OVERRIDE di atas dan rerun.`);
      failedSellers.push(username);
      continue;
    }

    console.log(`Ambil pricelist toko "${username}" (sellerId=${sellerId})...`);
    const items = await fetchSellerCatalog(sellerId, username);
    console.log(`  -> ${items.length} produk ditemukan.`);

    for (const it of items) {
      const activeVariants = (it.variants || []).filter(v => v.isActive !== false && v.price != null);
      const cheapestVariant = activeVariants.slice().sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];

      rows.push({
        toko_username: username,
        seller_id: sellerId,
        seller_name: it.sellerName || "",
        product_id: it.id || "",
        product_name: it.name || "",
        product_slug: it.slug || "",
        is_active: it.isActive,
        status: it.status || "",
        harga_default: it.defaultPrice ?? "",
        harga_default_pajak: it.defaultPriceWithTax ?? "",
        harga_min: it.minPrice ?? "",
        harga_min_pajak: it.minPriceWithTax ?? "",
        harga_max: it.maxPrice ?? "",
        harga_max_pajak: it.maxPriceWithTax ?? "",
        harga_varian_termurah: cheapestVariant?.price ?? "",
        harga_varian_termurah_pajak: cheapestVariant?.priceWithTax ?? "",
        jumlah_varian: (it.variants || []).length,
        stok_tersedia: it.stockAvailability ?? "",
        stok_akumulasi: it.stockAccumulation ?? "",
        unit_terjual: it.unitSold ?? "",
        tkdn_value: it.tkdn?.value ?? "",
        tkdn_bmp: it.tkdn?.bmpValue ?? "",
        tkdn_status: it.tkdn?.status ?? "",
        kategori: it.category?.name || "",
        brand: it.brand?.brandName || "",
        lokasi: it.location?.name || "",
        labels: (it.labels || []).join(", ")
      });
    }
    await sleep(300);
  }

  // ---------- build & download TSV ----------
  const escape = (v) => String(v ?? "").replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
  if (rows.length > 0) {
    const cols = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => cols.add(k)));
    const columns = [...cols];
    const header = columns.join("\t");
    const body = rows.map(r => columns.map(c => escape(r[c])).join("\t")).join("\n");
    const tsv = header + "\n" + body;
    const blob = new Blob([tsv], { type: "text/tab-separated-values" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "4-pricelist-toko-kompetitor.tsv";
    link.click();
  }

  console.log(`Selesai! ${rows.length} baris produk dari ${SELLER_USERNAMES.length - failedSellers.length}/${SELLER_USERNAMES.length} toko.`);
  if (failedSellers.length > 0) {
    console.warn(`Gagal resolve sellerId utk: ${failedSellers.join(", ")}. Lihat instruksi manual di atas.`);
  }
})();