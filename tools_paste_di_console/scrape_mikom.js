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

  // ---------- 2. Ambil detail evaluasi tiap kompetisi ----------
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
    // Kumpulkan SEMUA entry item dari SEMUA proposal (bisa lebih dari satu opsi produk per item)
    const allProposalItems = proposals.flatMap(p =>
      (p.items || []).map(it => ({ ...it, proposalTotal: p.total, proposalId: p.id }))
    );

    if (items.length === 0) {
      rows.push({ ...baseRow, note: "belum ada data evaluasi item" });
    } else {
      for (const item of items) {
        // Cari kandidat harga saya untuk item ini
        const candidates = allProposalItems.filter(mi => mi.competitionItemId === item.id);
        // PRIORITASKAN yang isSelected === true; kalau tidak ada, ambil yang pertama tapi tandai
        let myItem = candidates.find(c => c.isSelected === true);
        let isPriceConfirmed = true;
        if (!myItem && candidates.length > 0) {
          myItem = candidates[0];
          isPriceConfirmed = false; // harga ini bukan yang confirmed/selected, hati-hati
        }

        const winner = item.winner || {};
        const hpsUnit = item.price ?? "";
        const qty = item.qty ?? "";
        const hpsTotalEst = (typeof hpsUnit === "number" && typeof qty === "number") ? hpsUnit * qty : "";

        const myUnit = myItem?.price ?? "";
        // Total dihitung ULANG dari unit x qty (apple-to-apple dengan winner.total),
        // BUKAN pakai proposal.total mentah (bisa gabungan beberapa opsi produk / item lain)
        const myTotalCalc = (typeof myUnit === "number" && typeof qty === "number") ? myUnit * qty : "";
        const winnerTotal = winner.total ?? "";
        const winnerUnit = (typeof winnerTotal === "number" && typeof qty === "number" && qty !== 0)
          ? winnerTotal / qty : "";

        const gap = (typeof myTotalCalc === "number" && typeof winnerTotal === "number")
          ? (myTotalCalc - winnerTotal) : "";
        const gapPct = (typeof gap === "number" && typeof winnerTotal === "number" && winnerTotal !== 0)
          ? ((gap / winnerTotal) * 100).toFixed(2) : "";

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
          harga_confirmed: isPriceConfirmed, // FALSE = data harga ini bukan opsi yang isSelected, perlu dicek manual
          pemenang_nama: winner.sellerName || (item.isNoWinner ? "TIDAK ADA PEMENANG" : ""),
          pemenang_unit_price: winnerUnit,
          pemenang_total: winnerTotal,
          pemenang_rank: winner.rank ?? "",
          selisih_saya_vs_pemenang: gap,
          selisih_persen: gapPct
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
  link.download = "evaluasi-mikom-lengkap-v2.tsv";
  link.click();

  const unconfirmedCount = rows.filter(r => r.harga_confirmed === false).length;
  console.log(`Selesai! Total baris: ${rows.length}. File evaluasi-mikom-lengkap-v2.tsv sudah didownload.`);
  if (unconfirmedCount > 0) {
    console.warn(`Perhatian: ${unconfirmedCount} baris punya harga_confirmed=false, artinya sistem tidak menandai opsi produk mana yang final dipakai — cek manual di halaman aslinya kalau perlu.`);
  }
})();