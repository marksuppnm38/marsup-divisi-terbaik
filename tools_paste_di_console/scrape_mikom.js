(async () => {
  const BASE = "https://penyedia.inaproc.id";
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rid = () => Math.random().toString(36).slice(2);

  // ---------- Helper: parse satu RSC response text jadi list of parsed JSON chunks ----------
  function parseRSCChunks(text) {
    const chunks = [];
    for (const line of text.split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const rest = line.slice(idx + 1);
      try {
        chunks.push(JSON.parse(rest));
      } catch (e) {
        // bukan JSON valid (string/HTML/base64 partial), skip
      }
    }
    return chunks;
  }

  // Cari object yang punya key tertentu, rekursif di semua chunk
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

  // Cari object pertama yang cocok salah satu dari beberapa kandidat key (urutan prioritas)
  function findFirstKeyDeep(obj, targetKeys, seen = new Set()) {
    for (const key of targetKeys) {
      const found = findKeyDeep(obj, key, new Set());
      if (found !== null && found !== undefined) return { key, value: found };
    }
    return null;
  }

  // ---------- NEW v8: cari object mana pun yang punya property bernilai persis `targetValue`.
  // Ini lebih robust daripada nebak nama key: berapapun namanya, kalau ada objek dengan
  // field yg nilainya == productId yang kita cari, itu HAMPIR PASTI object detail produknya
  // (karena productId biasanya jadi salah satu field di object detail tsb).
  function findObjectsContainingValue(root, targetValue, seen = new Set()) {
    const results = [];
    function walk(obj) {
      if (obj === null || typeof obj !== "object") return;
      if (seen.has(obj)) return;
      seen.add(obj);
      if (!Array.isArray(obj)) {
        for (const v of Object.values(obj)) {
          if (v === targetValue) {
            results.push(obj);
            break;
          }
        }
      }
      const values = Array.isArray(obj) ? obj : Object.values(obj);
      for (const v of values) walk(v);
    }
    walk(root);
    return results;
  }

  // ---------- NEW v4: fetch ranking via GraphQL (ini yang beneran punya data "kenapa kalah") ----------
  const RANKING_QUERY = `query minikomProposalRanking($_v1_input: ProposalRankingInput!) {
    _v1_minikomProposalRanking: minikomProposalRanking(input: $_v1_input) {
      ... on ProposalRankingResponse {
        competitionTotal
        total
        perPage
        lastPage
        currentPage
        isEvaluated
        isItemized
        competitionId
        competitionKey
        isConstruction
        competitionStatus
        sellerRank
        items {
          isCurrentUserSeller
          competitionId
          id
          sellerName
          status
          total
          isReasonablePrice
          items {
            competitionDetailId
            tkdn
            bmp
            isPdn
            productName
            productPath
            productId
            productVersion
            price
            subtotalWithTax
            status
            reason
            subReason
          }
        }
      }
      ... on GenericError {
        __typename
        code
        message
        reqId
      }
    }
  }`;

  // ---------- NEW v8: circuit breaker kalau token/session expired di tengah jalan ----------
  // Kalau GraphQL balikin non-2xx berkali-kali berturut-turut, kemungkinan besar
  // gtp.accessToken sudah expired (token-nya short-lived, ~15 menit) dan REFRESH HALAMAN
  // gak akan kebantu tanpa rerun script. Daripada nyoba 400 terus sampai kelar (buang waktu +
  // ngerusak data jadi seolah "belum ada ranking"), kita stop lebih awal & kasih tau user.
  let consecutiveGraphQLFailures = 0;
  const MAX_CONSECUTIVE_GRAPHQL_FAILURES = 5;
  let tokenLikelyExpired = false;

  async function fetchRankingPage(compId, itemId, page) {
    const body = {
      query: RANKING_QUERY,
      variables: {
        _v1_input: {
          filter: {
            competitionId: compId,
            itemizedFilter: { competitionDetailId: itemId }
          },
          pagination: { perPage: 20, page }
        }
      },
      operationName: "minikomProposalRanking"
    };
    const res = await fetch(`${BASE}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "*/*" },
      credentials: "include",
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      consecutiveGraphQLFailures++;
      console.error(`[GraphQL] HTTP ${res.status} utk comp=${compId} item=${itemId}. Body (potongan): ${errText.slice(0, 300)}`);
      if (consecutiveGraphQLFailures >= MAX_CONSECUTIVE_GRAPHQL_FAILURES) {
        tokenLikelyExpired = true;
      }
      return null;
    }
    consecutiveGraphQLFailures = 0;
    const json = await res.json();
    return json?.data?._v1_minikomProposalRanking || null;
  }

  // Ambil semua halaman ranking untuk 1 item (biasanya cuma 1 halaman, tapi jaga-jaga kalau bidder banyak)
  async function fetchRanking(compId, itemId) {
    let page = 1;
    let lastPage = 1;
    let allEntries = [];
    let meta = null;
    do {
      const result = await fetchRankingPage(compId, itemId, page);
      if (!result) {
        return { ok: false, sellerRank: "", entries: [], raw: null };
      }
      if (result.__typename === "GenericError" || result.code) {
        return { ok: false, sellerRank: "", entries: [], raw: result };
      }
      meta = result;
      lastPage = result.lastPage || 1;
      allEntries.push(...(result.items || []));
      page++;
      if (page <= lastPage) await sleep(150);
    } while (page <= lastPage);

    return {
      ok: true,
      sellerRank: meta?.sellerRank ?? "",
      totalBidderRanking: meta?.total ?? allEntries.length,
      isEvaluated: meta?.isEvaluated ?? "",
      competitionStatus: meta?.competitionStatus ?? "",
      entries: allEntries,
      raw: meta
    };
  }

  function buildRankingSummary(entries) {
    if (!entries || entries.length === 0) return "";
    return entries.map((e, idx) => {
      const tag = e.isCurrentUserSeller ? " (SAYA)" : "";
      let line = `${idx + 1}. ${e.sellerName}${tag} - ${e.status} - Rp${e.total}`;
      return line;
    }).join(" | ");
  }

  // Ambil baris "alasan" milik kita sendiri (isCurrentUserSeller true), untuk item spesifik ini
  // NOTE v6: productName/productPath sudah ada di response GraphQL ini (lihat RANKING_QUERY items),
  // jadi dipakai langsung sebagai nama_produk_item — gak perlu fetch halaman ranking terpisah lagi.
  // NOTE v7: sekarang juga ambil productId + productVersion dari sini, dipakai buat fetch snapshot-product.
  function extractMyReason(entries, itemId) {
    const mine = (entries || []).find(e => e.isCurrentUserSeller === true);
    if (!mine) {
      return {
        status: "", price: "", detailStatus: "", reason: "", subReason: "",
        productName: "", productPath: "", productId: "", productVersion: ""
      };
    }
    const detail = (mine.items || []).find(d => d.competitionDetailId === itemId) || (mine.items || [])[0] || {};
    return {
      status: mine.status ?? "",
      price: mine.total ?? "",
      detailStatus: detail.status ?? "",
      reason: detail.reason ?? "",
      subReason: detail.subReason ?? "",
      productName: detail.productName ?? "",
      productPath: detail.productPath ?? "",
      productId: detail.productId ?? "",
      productVersion: detail.productVersion ?? ""
    };
  }

  // ---------- NEW v5/v6: fetch nama produk dari halaman ranking (SSR HTML) - dipakai sbg FALLBACK saja ----------
  const productNameCache = new Map(); // key: `${compId}|${itemId}` -> nama produk

  function extractProductNameFromHTML(html) {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const el = doc.querySelector(".text-tertiary500.text-caption-lg-semibold");
      if (el && el.textContent.trim()) return el.textContent.trim();
    } catch (e) {
      // ignore, fallback ke regex
    }
    const m = html.match(/class="[^"]*text-tertiary500[^"]*text-caption-lg-semibold[^"]*"[^>]*>([^<]+)</);
    return m ? m[1].trim() : "";
  }

  async function fetchProductName(compId, itemId) {
    const cacheKey = `${compId}|${itemId}`;
    if (productNameCache.has(cacheKey)) return productNameCache.get(cacheKey);
    const url = `${BASE}/mini-competition/evaluation/ranking/${compId}/${itemId}`;
    let name = "";
    try {
      const res = await fetch(url, {
        headers: { accept: "text/html" },
        credentials: "include"
      });
      const html = await res.text();
      name = extractProductNameFromHTML(html);
      if (!name) {
        console.warn(`Nama produk kosong utk ${compId}/${itemId} (cek selector, mungkin markup berubah)`);
      }
    } catch (e) {
      console.error(`Gagal fetch nama produk ${compId}/${itemId}:`, e);
    }
    productNameCache.set(cacheKey, name);
    return name;
  }

  // ---------- NEW v9: fetch "produk tayang" via /snapshot-product ----------
  // Struktur ASLI sudah dikonfirmasi dari sample nyata (bukan tebakan lagi):
  // chunk RSC berisi 1 object dgn key "data" (persis 1x kemunculan di seluruh payload) yg isinya:
  //   data.images: string[]  (URL gambar produk)
  //   data.productInformation: { name, labels[], slug, isFtz }
  //   data.pdnInformation: { tkdn: {value, bmpValue, status, companyName, url, number}, pdn: {type, countryName, countryCode} }
  //   data.detailInformation: { description, category, productType, shipping, primaryUnit,
  //                              mainInformations: [{name, value}, ...],  <- spesifikasi teknis lengkap
  //                              additionalInformations: [...], brand: {brandName, url, status},
  //                              sni, klpdDescription, kbki, sku, documents: [...], tax }
  //   data.date: { dateLabel, timeLabel }
  //   data.sellerInformation: { name, isUmkk, username, city }
  // TIDAK ADA field harga di snapshot ini (harga penawaran sudah diambil terpisah dari GraphQL ranking).
  function findProductSnapshotData(chunks) {
    for (const c of chunks) {
      const found = findKeyDeep(c, "data");
      if (found && typeof found === "object" && found.productInformation) return found;
    }
    return null;
  }

  const productSnapshotCache = new Map(); // key: `${compId}|${productId}|${productVersion}` -> hasil

  async function fetchProductSnapshot(compId, compKey, productId, productVersion) {
    if (!productId) {
      return { ok: false, reason: "productId kosong", raw: null };
    }
    const cacheKey = `${compId}|${productId}|${productVersion || ""}`;
    if (productSnapshotCache.has(cacheKey)) return productSnapshotCache.get(cacheKey);

    const params = new URLSearchParams({
      competitionId: compId,
      competitionKey: compKey,
      productId,
      source: "minicom",
      version: String(productVersion || 2),
      _rsc: rid()
    });
    const url = `${BASE}/snapshot-product?${params.toString()}`;

    let result;
    try {
      const res = await fetch(url, {
        headers: { rsc: "1", accept: "*/*" },
        credentials: "include"
      });
      const raw = await res.text();
      const chunks = parseRSCChunks(raw);
      const d = findProductSnapshotData(chunks);

      if (d) {
        const pi = d.productInformation || {};
        const di = d.detailInformation || {};
        const pdn = d.pdnInformation || {};
        const seller = d.sellerInformation || {};
        const spesifikasi = (di.mainInformations || [])
          .filter(m => m.value)
          .map(m => `${m.name}: ${m.value}`)
          .join(" | ");
        result = {
          ok: true,
          nama: pi.name || "",
          slug: pi.slug || "",
          labels: (pi.labels || []).join(", "),
          brand: di.brand?.brandName || "",
          tkdnValue: pdn.tkdn?.value ?? "",
          tkdnStatus: pdn.tkdn?.status ?? "",
          pdnType: pdn.pdn?.type || "",
          kbki: di.kbki || "",
          sku: di.sku || "",
          spesifikasi,
          gambar: (d.images || []).join(" | "),
          sellerNama: seller.name || "",
          sellerKota: seller.city || "",
          raw: d
        };
      } else {
        // Gak ketemu -> simpan preview mentah (dipotong) buat debug lanjutan kalau formatnya beda2 per kompetisi
        result = { ok: false, raw: null, rawTextPreview: raw.slice(0, 500), rawTextLength: raw.length };
        console.warn(`[snapshot-product] Data produk gak ketemu utk productId=${productId} (panjang respons: ${raw.length} karakter). Struktur mungkin beda utk kompetisi ini.`);
      }
    } catch (e) {
      console.error(`Gagal fetch snapshot-product utk productId=${productId}:`, e);
      result = { ok: false, raw: null, error: String(e) };
    }

    productSnapshotCache.set(cacheKey, result);
    return result;
  }

  // ---------- 1. Ambil semua item kompetisi (paginated) ----------
  console.log("Mengambil daftar kompetisi (paginated)...");
  let allItems = [];
  let page = 1;
  let lastPage = 1;
  do {
    const url = `${BASE}/mini-competition/my-competition?page=${page}&_rsc=${rid()}`;
    const res = await fetch(url, {
      headers: { rsc: "1", accept: "*/*" },
      credentials: "include"
    });
    const raw = await res.text();
    const chunks = parseRSCChunks(raw);
    let listData = null;
    for (const c of chunks) {
      const found = findKeyDeep(c, "listData");
      if (found) { listData = found; break; }
    }
    if (!listData || !Array.isArray(listData.items)) {
      console.error(`Gagal ambil halaman ${page}, berhenti.`);
      break;
    }
    lastPage = listData.lastPage || 1;
    allItems.push(...listData.items);
    console.log(`Halaman ${page}/${lastPage}: +${listData.items.length} item (total terkumpul: ${allItems.length})`);
    page++;
    await sleep(250);
  } while (page <= lastPage);
  console.log(`Selesai ambil daftar. Total kompetisi: ${allItems.length}`);

  // ---------- 2. Ambil detail evaluasi + ranking (GraphQL) + snapshot produk tiap kompetisi ----------
  const rows = [];
  const skippedComps = [];
  let i = 0;
  let snapshotDebugLogged = false;
  for (const comp of allItems) {
    i++;

    // ---------- NEW v8: kalau token kelihatan expired, STOP proses sisanya (bukan terus gagal 400 sampai habis) ----------
    if (tokenLikelyExpired) {
      const remaining = allItems.slice(i - 1);
      skippedComps.push(...remaining.map(c => ({ id: c.id, key: c.key, title: c.title })));
      console.warn(`Berhenti lebih awal di kompetisi ke-${i}/${allItems.length}: token/session kelihatan sudah expired (${MAX_CONSECUTIVE_GRAPHQL_FAILURES}x GraphQL error berturut-turut). ${remaining.length} kompetisi sisanya BELUM diproses.`);
      break;
    }
    const url = `${BASE}/mini-competition/evaluation/preview?id=${comp.id}&key=${comp.key}&_rsc=${rid()}`;
    let competitionData = null;
    try {
      const res = await fetch(url, {
        headers: { rsc: "1", accept: "*/*" },
        credentials: "include"
      });
      const raw = await res.text();
      const chunks = parseRSCChunks(raw);
      for (const c of chunks) {
        const found = findKeyDeep(c, "competitionData");
        if (found) { competitionData = found; break; }
      }
    } catch (e) {
      console.error(`Gagal fetch evaluasi ${comp.id}:`, e);
    }

    const baseRow = {
      id: comp.id,
      key: comp.key,
      title: comp.title,
      status: comp.status,
      proposalStatus: comp.proposalStatus,
      totalBidder: comp.totalBidder,
      publishedAt: comp.publishedAt,
      startPeriod: comp.startPeriod,
      endPeriod: comp.endPeriod,
      shipment_city: comp.shipment?.city || "",
      shipment_province: comp.shipment?.province || "",
      institution: comp.assignedUser?.institutionName || ""
    };

    const items = competitionData?.items || [];
    const proposals = competitionData?.proposals || [];
    const allProposalItems = proposals.flatMap(p =>
      (p.items || []).map(it => ({ ...it, proposalTotal: p.total, proposalId: p.id }))
    );

    if (items.length === 0) {
      rows.push({ ...baseRow, note: "belum ada data evaluasi item" });
    } else {
      for (const item of items) {
        const candidates = allProposalItems.filter(mi => mi.competitionItemId === item.id);
        let myItem = candidates.find(c => c.isSelected === true);
        let isPriceConfirmed = true;
        if (!myItem && candidates.length > 0) {
          myItem = candidates[0];
          isPriceConfirmed = false;
        }

        const winner = item.winner || {};
        const hpsUnit = item.price ?? "";
        const qty = item.qty ?? "";
        const hpsTotalEst = (typeof hpsUnit === "number" && typeof qty === "number") ? hpsUnit * qty : "";
        const myUnit = myItem?.price ?? "";
        const myTotalCalc = (typeof myUnit === "number" && typeof qty === "number") ? myUnit * qty : "";
        const winnerTotal = winner.total ?? "";
        const winnerUnit = (typeof winnerTotal === "number" && typeof qty === "number" && qty !== 0)
          ? winnerTotal / qty : "";
        const gap = (typeof myTotalCalc === "number" && typeof winnerTotal === "number")
          ? (myTotalCalc - winnerTotal) : "";
        const gapPct = (typeof gap === "number" && typeof winnerTotal === "number" && winnerTotal !== 0)
          ? ((gap / winnerTotal) * 100).toFixed(2) : "";

        // ---------- ranking + alasan kalah dari GraphQL ----------
        const rankingResult = await fetchRanking(comp.id, item.id);
        const myReason = extractMyReason(rankingResult.entries, item.id);
        await sleep(200);

        // ---------- nama produk item: utamakan dari GraphQL, fallback scrape halaman ranking ----------
        let productName = myReason.productName;
        if (!productName) {
          productName = await fetchProductName(comp.id, item.id);
          await sleep(150);
        }

        // ---------- NEW v9: snapshot produk tayang (detail lengkap dari /snapshot-product) ----------
        let productSnapshot = { ok: false, raw: null };
        if (myReason.productId) {
          productSnapshot = await fetchProductSnapshot(comp.id, comp.key, myReason.productId, myReason.productVersion);
          await sleep(200);
        }

        rows.push({
          ...baseRow,
          nama_produk_item: productName,
          nama_produk_path: myReason.productPath,
          product_id: myReason.productId,
          product_version: myReason.productVersion,
          category_top: item.category?.parent?.parent?.name || "",
          category_sub: item.category?.parent?.name || "",
          category_item: item.category?.name || "",
          item_qty: qty,
          item_unit: item.unit || "",
          hps_unit_price: hpsUnit,
          hps_total_estimasi: hpsTotalEst,
          harga_saya_per_unit: myUnit,
          total_penawaran_saya: myTotalCalc,
          harga_confirmed: isPriceConfirmed,
          pemenang_nama: winner.sellerName || (item.isNoWinner ? "TIDAK ADA PEMENANG" : ""),
          pemenang_unit_price: winnerUnit,
          pemenang_total: winnerTotal,
          pemenang_rank: winner.rank ?? "",
          selisih_saya_vs_pemenang: gap,
          selisih_persen: gapPct,
          // ---------- kolom ranking & alasan (dari GraphQL minikomProposalRanking) ----------
          ranking_fetch_ok: rankingResult.ok,
          my_rank: rankingResult.sellerRank,
          total_bidder_ranking: rankingResult.totalBidderRanking ?? "",
          my_proposal_status: myReason.status,
          my_item_status: myReason.detailStatus,
          alasan_kalah: myReason.reason,
          alasan_kalah_detail: myReason.subReason,
          ranking_summary: buildRankingSummary(rankingResult.entries),
          // ---------- kolom produk tayang (dari /snapshot-product, struktur asli terkonfirmasi v9) ----------
          produk_tayang_fetch_ok: productSnapshot.ok,
          produk_tayang_nama: productSnapshot.nama || "",
          produk_tayang_slug: productSnapshot.slug || "",
          produk_tayang_labels: productSnapshot.labels || "",
          produk_tayang_brand: productSnapshot.brand || "",
          produk_tayang_tkdn_value: productSnapshot.tkdnValue ?? "",
          produk_tayang_tkdn_status: productSnapshot.tkdnStatus || "",
          produk_tayang_pdn_type: productSnapshot.pdnType || "",
          produk_tayang_kbki: productSnapshot.kbki || "",
          produk_tayang_sku: productSnapshot.sku || "",
          produk_tayang_spesifikasi: (productSnapshot.spesifikasi || "").slice(0, 1500),
          produk_tayang_gambar: productSnapshot.gambar || "",
          produk_tayang_seller_nama: productSnapshot.sellerNama || "",
          produk_tayang_seller_kota: productSnapshot.sellerKota || ""
        });
      }
    }
    console.log(`(${i}/${allItems.length}) OK: ${comp.id} [${comp.proposalStatus}]`);
    await sleep(250);
  }

  // ---------- 3. Build TSV ----------
  const allColumns = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => allColumns.add(k)));
  const columns = [...allColumns];
  const escape = (v) => String(v ?? "").replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
  const header = columns.join("\t");
  const body = rows.map(r => columns.map(c => escape(r[c])).join("\t")).join("\n");
  const tsv = header + "\n" + body;

  const blob = new Blob([tsv], { type: "text/tab-separated-values" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "evaluasi-mikom-lengkap-v8.tsv";
  link.click();

  // ---------- NEW v8: kalau ada kompetisi yang di-skip krn token expired, download daftar sisanya ----------
  if (skippedComps.length > 0) {
    const skippedTsv = "id\tkey\ttitle\n" + skippedComps.map(c => `${c.id}\t${c.key}\t${escape(c.title)}`).join("\n");
    const skippedBlob = new Blob([skippedTsv], { type: "text/tab-separated-values" });
    const skippedLink = document.createElement("a");
    skippedLink.href = URL.createObjectURL(skippedBlob);
    skippedLink.download = "SISA-belum-diproses-refresh-lalu-rerun.tsv";
    skippedLink.click();
  }

  const unconfirmedCount = rows.filter(r => r.harga_confirmed === false).length;
  const rankingFailCount = rows.filter(r => r.ranking_fetch_ok === false).length;
  const withReasonCount = rows.filter(r => r.alasan_kalah).length;
  const missingProductNameCount = rows.filter(r => "nama_produk_item" in r && !r.nama_produk_item).length;
  const snapshotFailCount = rows.filter(r => r.produk_tayang_fetch_ok === false).length;

  console.log(`Selesai! Total baris: ${rows.length}. File evaluasi-mikom-lengkap-v8.tsv sudah didownload.`);
  if (skippedComps.length > 0) {
    console.warn(`PENTING: ${skippedComps.length} kompetisi BELUM diproses krn token/session expired di tengah jalan. File SISA-belum-diproses-refresh-lalu-rerun.tsv sudah didownload berisi daftarnya. Silakan REFRESH HALAMAN (biar dapet token baru), lalu jalankan script ini lagi -- baris yang sudah ada gak akan hilang, cukup gabung 2 file TSV-nya nanti.`);
  }
  if (unconfirmedCount > 0) {
    console.warn(`Perhatian: ${unconfirmedCount} baris punya harga_confirmed=false, cek manual opsi produk mana yang final.`);
  }
  if (rankingFailCount > 0) {
    console.warn(`Perhatian: ${rankingFailCount} baris gagal fetch ranking GraphQL (cek console error / mungkin token expired, coba refresh halaman & rerun).`);
  }
  if (missingProductNameCount > 0) {
    console.warn(`Perhatian: ${missingProductNameCount} baris gagal ambil nama_produk_item (cek console warning / markup mungkin berubah).`);
  }
  if (snapshotFailCount > 0) {
    console.warn(`Perhatian: ${snapshotFailCount} baris gagal parsing produk_tayang (struktur /snapshot-product belum dikenal parser). Cek console.log "[snapshot-product]" di atas, lalu kasih tau saya nama field yang benar biar extractor-nya diperbaiki.`);
  }
  console.log(`${withReasonCount} baris punya alasan_kalah terisi (dari field 'reason' GraphQL).`);
})();