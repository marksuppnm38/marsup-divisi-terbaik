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
  function extractMyReason(entries, itemId) {
    const mine = (entries || []).find(e => e.isCurrentUserSeller === true);
    if (!mine) return { status: "", price: "", detailStatus: "", reason: "", subReason: "" };
    const detail = (mine.items || []).find(d => d.competitionDetailId === itemId) || (mine.items || [])[0] || {};
    return {
      status: mine.status ?? "",
      price: mine.total ?? "",
      detailStatus: detail.status ?? "",
      reason: detail.reason ?? "",
      subReason: detail.subReason ?? ""
    };
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

  // ---------- 2. Ambil detail evaluasi + ranking (GraphQL) tiap kompetisi ----------
  const rows = [];
  let i = 0;
  for (const comp of allItems) {
    i++;
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

        // ---------- NEW v4: data ranking + alasan kalah dari GraphQL ----------
        const rankingResult = await fetchRanking(comp.id, item.id);
        const myReason = extractMyReason(rankingResult.entries, item.id);
        await sleep(200);

        rows.push({
          ...baseRow,
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
          // ---------- kolom ranking & alasan (BARU, dari GraphQL minikomProposalRanking) ----------
          ranking_fetch_ok: rankingResult.ok,
          my_rank: rankingResult.sellerRank,
          total_bidder_ranking: rankingResult.totalBidderRanking ?? "",
          my_proposal_status: myReason.status,
          my_item_status: myReason.detailStatus,
          alasan_kalah: myReason.reason,
          alasan_kalah_detail: myReason.subReason,
          ranking_summary: buildRankingSummary(rankingResult.entries)
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
  link.download = "evaluasi-mikom-lengkap-v4.tsv";
  link.click();

  const unconfirmedCount = rows.filter(r => r.harga_confirmed === false).length;
  const rankingFailCount = rows.filter(r => r.ranking_fetch_ok === false).length;
  const withReasonCount = rows.filter(r => r.alasan_kalah).length;

  console.log(`Selesai! Total baris: ${rows.length}. File evaluasi-mikom-lengkap-v4.tsv sudah didownload.`);
  if (unconfirmedCount > 0) {
    console.warn(`Perhatian: ${unconfirmedCount} baris punya harga_confirmed=false, cek manual opsi produk mana yang final.`);
  }
  if (rankingFailCount > 0) {
    console.warn(`Perhatian: ${rankingFailCount} baris gagal fetch ranking GraphQL (cek console error detail di atas / mungkin token expired, coba refresh halaman & rerun).`);
  }
  console.log(`${withReasonCount} baris punya alasan_kalah terisi (dari field 'reason' GraphQL).`);
})();