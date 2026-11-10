// shared/exports/pricelist.js
// Satu-satunya tempat logic Export Pricelist (Sales). Dipanggil dari dua pintu:
// crud-produk (ikut filter yang aktif) dan dashboard (pilih scope tipe).
// Tidak menyentuh DOM/toast: pemanggil yang menampilkan pesan.

// produk_id -> {tahun, ekatalog, swasta}. Tahun terbaru ditentukan dari baris
// EKATALOG (harga input manual); SWASTA/UPLOAD turunan rumus di tahun yang sama.
export async function fetchHargaLatestMap(sb, produkIds) {
  const map = new Map();
  const CHUNK = 300;
  for (let i = 0; i < produkIds.length; i += CHUNK) {
    const { data, error } = await sb.from('produk_harga')
      .select('produk_id,tahun,jenis,harga')
      .in('produk_id', produkIds.slice(i, i + CHUNK));
    if (error) throw new Error('Gagal ambil data harga: ' + error.message);
    (data || []).forEach((h) => {
      const ex = map.get(h.produk_id);
      if (!ex || h.tahun > ex.tahun) map.set(h.produk_id, { tahun: h.tahun, ekatalog: null, swasta: null });
      const e = map.get(h.produk_id);
      if (h.tahun === e.tahun) {
        if (h.jenis === 'EKATALOG') e.ekatalog = h.harga;
        if (h.jenis === 'SWASTA') e.swasta = h.harga;
      }
    });
  }
  return map;
}

// Hanya produk yang siap jual: Link V6 bersih DAN harga EKATALOG ada.
// isCleanLink(row) disuplai pemanggil (parseLinkV6 tetap satu sumber di ui-utils).
export function selectPricelistRows(rows, hargaMap, isCleanLink) {
  const withLink = rows.filter(isCleanLink);
  const priced = withLink.filter((r) => { const h = hargaMap.get(r.id); return h && h.ekatalog != null; });
  priced.sort((a, b) => (a.golongan || '').localeCompare(b.golongan || '', 'id')
    || (a.nama_produk || '').localeCompare(b.nama_produk || '', 'id'));
  return { priced, skippedNoLink: rows.length - withLink.length, skippedNoHarga: withLink.length - priced.length };
}

// XLSX harus build xlsx-js-style (xlsx biasa diam-diam membuang style).
export function writePricelistXlsx(XLSX, priced, hargaMap, { subtitle, fileTag = '_semua' }) {
  const HEADER = ['No', 'Kode Produk', 'Nama Produk', 'Golongan', 'Harga EKATALOG', 'Harga SWASTA', 'Tahun Harga', 'Link Katalog'];
  const dateStr = new Date().toISOString().slice(0, 10);
  const aoa = [['PRICELIST PRODUK'], [`${subtitle} — per ${dateStr} — ${priced.length} produk`], HEADER];
  priced.forEach((r, i) => {
    const h = hargaMap.get(r.id);
    aoa.push([i + 1, r.kode_produk || '', r.nama_produk || '', r.golongan || '', h.ekatalog, h.swasta != null ? h.swasta : '', h.tahun, r.link_v6 || '']);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastCol = HEADER.length - 1, lastRow = aoa.length - 1;
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }, { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } }];
  ws['A1'].s = { font: { bold: true, sz: 15 } };
  ws['A2'].s = { font: { italic: true, sz: 10.5, color: { rgb: '666666' } } };
  const thin = { style: 'thin', color: { rgb: 'D9D9D9' } };
  const box = { top: thin, bottom: thin, left: thin, right: thin };
  HEADER.forEach((_, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c })];
    if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2F5496' } }, alignment: { vertical: 'center', horizontal: 'center' }, border: box };
  });
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } }) };
  for (let r = 3; r <= lastRow; r++) {
    for (let c = 0; c <= lastCol; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const s = { border: box };
      if ((r - 3) % 2 === 1) s.fill = { fgColor: { rgb: 'F2F2F2' } };
      if (c === 0 || c === 6) s.alignment = { horizontal: 'center' };
      if ((c === 4 || c === 5) && typeof cell.v === 'number') cell.z = '"Rp" #,##0';
      cell.s = s;
    }
  }
  ws['!cols'] = [5, 22, 45, 18, 16, 16, 12, 45].map((wch) => ({ wch }));
  ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pricelist');
  XLSX.writeFile(wb, `pricelist_sales_${dateStr}${fileTag}.xlsx`);
}