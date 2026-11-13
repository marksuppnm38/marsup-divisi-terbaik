// shared/exports/tabel-xlsx.js
// Penulis Excel generik untuk "export apa yang tampil di tabel". Tidak tahu apa-apa soal produk:
// pemanggil memberi kolom (label + format) dan baris (array nilai). Tidak menyentuh DOM/toast.
//
// columns: [{ id?, label, fmt, w, f? }]
//   fmt: 'text' (default) | 'center' | 'rp' | 'int' | 'link' | 'status'
//   f(L, r1): rumus Excel opsional untuk sel angka; L(id) = huruf kolom bergelar id, r1 = nomor baris Excel
//             (return null/'' -> sel tetap angka biasa, mis. karena kolom yang dirujuk tidak ikut diexport)
// rows   : array of array, sejajar dengan columns. Nilai kosong = KOSONG ('—') atau null.
// totals : [{ label, id, value, bold }] baris ringkasan di bawah data (di luar autofilter)
// XLSX harus build xlsx-js-style (xlsx biasa diam-diam membuang style).

export const KOSONG = '—';

const STATUS_COLOR = {
  'Sudah ada AKD':      { fg: '1E6B3A', bg: 'E2F4E8' },
  'Belum ada AKD':      { fg: '9C2B2B', bg: 'FBE4E4' },
  'Disetujui':          { fg: '1E6B3A', bg: 'E2F4E8' },
  'Siap':               { fg: '1E6B3A', bg: 'E2F4E8' },
  'Indent':             { fg: '555555', bg: 'ECECEC' },
  'Data tidak lengkap': { fg: '8A5A00', bg: 'FFF1D6' },
};

export function writeTableXlsx(XLSX, { sheetName = 'Produk', title, subtitle, columns, rows, totals = [], fileName }) {
  const HEADER = ['No', ...columns.map((c) => c.label)];
  const cols = [{ label: 'No', fmt: 'center', w: 5 }, ...columns];
  const lastCol = HEADER.length - 1;
  const FIRST = 3; // 0-based: judul, subtitle, header
  const aoa = [[title], [subtitle], HEADER];
  rows.forEach((r, i) => aoa.push([i + 1, ...r.map((v) => (v == null || v === '' ? KOSONG : v))]));
  const lastData = aoa.length - 1;

  const idx = {};
  cols.forEach((c, i) => { if (c.id) idx[c.id] = i; });
  const L = (id) => (idx[id] == null ? null : XLSX.utils.encode_col(idx[id]));

  const totalRows = [];
  if (totals.length) {
    aoa.push(new Array(HEADER.length).fill(''));
    totals.forEach((t) => {
      const row = new Array(HEADER.length).fill('');
      const vc = idx[t.id];
      if (vc == null) return;
      row[Math.max(1, Math.min(2, vc - 1))] = t.label;
      row[vc] = t.value;
      totalRows.push({ r: aoa.length, t, vc, lc: Math.max(1, Math.min(2, vc - 1)) });
      aoa.push(row);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }, { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } }];
  ws['A1'].s = { font: { bold: true, sz: 15 } };
  ws['A2'].s = { font: { italic: true, sz: 10.5, color: { rgb: '666666' } } };

  const thin = { style: 'thin', color: { rgb: 'D9D9D9' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  HEADER.forEach((_, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r: 2, c })];
    if (cell) cell.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '2F5496' } }, alignment: { vertical: 'center', horizontal: 'center', wrapText: true }, border };
  });
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: lastData, c: lastCol } }) };
  const xSplit = cols[2] && cols[2].id === 'nama' ? 3 : 2; // No + Kode (+ Nama) tetap kelihatan saat scroll
  ws['!freeze'] = { xSplit, ySplit: 3 };
  ws['!views'] = [{ state: 'frozen', xSplit, ySplit: 3 }];

  for (let r = FIRST; r <= lastData; r++) {
    const zebra = (r - FIRST) % 2 === 1;
    for (let c = 0; c <= lastCol; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      const def = cols[c], fmt = def.fmt || 'text';
      const style = { border, alignment: { vertical: 'center' } };
      if (zebra) style.fill = { fgColor: { rgb: 'F2F2F2' } };
      const empty = cell.v === KOSONG;
      if (empty) style.font = { color: { rgb: 'A0A0A0' } };
      if (fmt === 'center' || fmt === 'status' || empty) style.alignment = { vertical: 'center', horizontal: 'center' };
      if (typeof cell.v === 'number') {
        if (fmt === 'rp') cell.z = '"Rp" #,##0';
        if (fmt === 'int') cell.z = '#,##0';
        if (fmt === 'rp' || fmt === 'int') style.alignment = { vertical: 'center', horizontal: 'right' };
        if (def.f) {
          const f = def.f(L, r + 1);
          if (f) cell.f = f; // rumus (bukan angka mati) supaya bisa diaudit di Excel
        }
      }
      if (fmt === 'status' && STATUS_COLOR[cell.v]) {
        const sc = STATUS_COLOR[cell.v];
        style.font = { bold: true, color: { rgb: sc.fg } };
        style.fill = { fgColor: { rgb: sc.bg } };
      }
      if (fmt === 'link' && !empty && /^https?:\/\//i.test(String(cell.v))) {
        cell.l = { Target: String(cell.v) };
        style.font = { color: { rgb: '0563C1' }, underline: true };
      }
      cell.s = style;
    }
  }

  const top = { top: { style: 'medium', color: { rgb: '2F5496' } } };
  totalRows.forEach(({ r, t, vc, lc }) => {
    const font = { bold: t.bold !== false, italic: t.bold === false, color: { rgb: t.bold === false ? '666666' : '000000' } };
    const lab = ws[XLSX.utils.encode_cell({ r, c: lc })], val = ws[XLSX.utils.encode_cell({ r, c: vc })];
    if (lab) lab.s = { font, border: t.bold === false ? undefined : top };
    if (val) { val.z = '"Rp" #,##0'; val.s = { font, alignment: { horizontal: 'right' }, border: t.bold === false ? undefined : top }; }
  });

  ws['!cols'] = cols.map((c) => ({ wch: c.w || 16 }));
  ws['!rows'] = [{ hpt: 22 }, { hpt: 16 }, { hpt: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}
