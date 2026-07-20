// ==== INAPROC Principal Applications Scraper ====
// Jalankan di Console tab, di halaman https://penyedia.inaproc.id/principal-applications

(async () => {
  const PER_PAGE = 50;
  const DELAY_MS = 300; // jeda antar request biar aman
  let allItems = [];
  let page = 1;
  let lastPage = 1;

  const query = `query getListProductPrincipal($input: ListProductPrincipalInput!) {
  productPrincipalList(input: $input) {
    ... on ListProductPrincipalResponse {
      total
      perPage
      currentPage
      lastPage
      items {
        updatedAt
        type
        status
        sellerId
        reason
        source
        id
        createdAt
        brandStatus
        brandOwner
        brandName
        approvalByUserID
        approvalByPersonaID
        approvalAt
        applicationNumber
        documents {
          id
          createdAt
          principalId
          token
          updatedAt
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

  async function fetchPage(p) {
    const res = await fetch("https://penyedia.inaproc.id/graphql", {
      headers: { "content-type": "application/json", accept: "*/*" },
      body: JSON.stringify({
        query,
        variables: { input: { filter: {}, pagination: { page: p, perPage: PER_PAGE } } },
        operationName: "getListProductPrincipal",
      }),
      method: "POST",
      mode: "cors",
      credentials: "include",
    });
    const json = await res.json();
    return json.data.productPrincipalList;
  }

  console.log("Mengambil halaman 1...");
  const first = await fetchPage(1);
  lastPage = first.lastPage;
  allItems = allItems.concat(first.items);
  console.log(`Total data: ${first.total}, total halaman: ${lastPage}`);

  for (page = 2; page <= lastPage; page++) {
    await new Promise((r) => setTimeout(r, DELAY_MS));
    const result = await fetchPage(page);
    allItems = allItems.concat(result.items);
    console.log(`Halaman ${page}/${lastPage} selesai (${allItems.length} data terkumpul)`);
  }

  console.log(`Selesai! Total data terkumpul: ${allItems.length}`);

  // ---- Convert ke CSV ----
  const statusMap = {
    PENDING: "Menunggu Persetujuan",
    APPROVED: "Disetujui",
    REJECTED: "Ditolak",
  };

  function formatTanggal(iso) {
    if (!iso) return "";
    const bulan = [
      "Januari","Februari","Maret","April","Mei","Juni",
      "Juli","Agustus","September","Oktober","November","Desember",
    ];
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
  }

  function csvEscape(val) {
    if (val === null || val === undefined) return "";
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  const headers = ["No", "Nama", "Kategori", "Nomor Permohonan", "Tgl Pengajuan", "Status", "Alasan Ditolak"];
  const rows = allItems.map((item, idx) => [
    idx + 1,
    item.brandName,
    "Alat Kesehatan", // sesuaikan kalau ada kategori lain di data kamu
    item.applicationNumber,
    formatTanggal(item.createdAt),
    statusMap[item.status] || item.status,
    item.reason || "",
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  // Tambah BOM biar Excel baca UTF-8 dengan benar (karakter aksen, dll)
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "inaproc_pengajuan_master_produk.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  console.log("CSV berhasil di-download!");

  // Simpan juga ke variable global kalau mau diinspeksi manual di console
  window.__inaprocData = allItems;
})();