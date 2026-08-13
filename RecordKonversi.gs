/**
 * RecordKonversi.gs
 *
 * v2 — nambahin dedupe berbasis idempotency key (record_id dari Supabase),
 * biar tombol "Coba Sync ke Sheet Lagi" di konversian.js gak bikin baris
 * duplikat kalau ternyata percobaan sebelumnya SUDAH beneran nyampe & ke-
 * appendRow, tapi respons JSON-nya gagal balik ke browser (mis. karena
 * lambat/timeout di jalur network — appendRow di sheet yang berat/banyak
 * conditional formatting bisa makan 10+ detik).
 *
 * PENTING — kolom baru:
 *   Ditambahkan SATU kolom baru di paling kanan sheet: RECORD_ID (kolom L
 *   kalau urutan lama kamu A..K seperti komentar di bawah). Kolom ini isinya
 *   ID record dari Supabase (bukan buat dibaca manual, cuma buat dedupe).
 *   Baris-baris LAMA yang udah ada sebelum kamu apply script ini gak akan
 *   punya RECORD_ID — gapapa, itu gak akan ke-dedupe balik karena payload
 *   baru gak akan pernah cocok sama baris kosong.
 *
 * Cara pakai (sama seperti sebelumnya):
 * 1. Buka Google Sheet "record konversi" kamu (kolom: TANGGAL, PIC_MARSUP,
 *    PIC_SALES, KEYWORD, REKANAN, CUSTOMER, DISTRIBUTOR, KATEGORI, VALUE,
 *    NOTES, LINK) — tambahin header "RECORD_ID" di kolom L kalau belum ada
 *    (opsional, cuma buat kerapian; scriptnya sendiri gak butuh header ini
 *    buat jalan).
 * 2. Extensions > Apps Script.
 * 3. Hapus isi lama, paste seluruh isi file ini.
 * 4. Ganti SHEET_NAME di bawah kalau nama tab sheet kamu bukan "RECORD_KONVERSI".
 * 5. Deploy > Manage deployments > pilih deployment Web app yang aktif >
 *    ikon pensil (Edit) > Version: "New version" > Deploy.
 *    (WAJIB bikin New version — kalau cuma disave doang di editor, URL /exec
 *    yang lagi dipakai konversian.js masih ngejalanin kode versi LAMA.)
 * 6. URL Web App-nya TETAP SAMA selama kamu edit deployment yang sudah ada
 *    (bukan bikin "New deployment" terpisah) — jadi GAS_WEBHOOK_URL di
 *    konversian.js gak perlu diubah.
 */

const SHEET_NAME = 'RECORD_KONVERSI'; // sesuaikan dengan nama tab sheet asli
const RECORD_ID_COL = 12; // kolom L (A=1 ... K=11, L=12) — tempat nyimpen record_id buat dedupe

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const recordId = data.record_id ? String(data.record_id) : '';

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error('Sheet "' + SHEET_NAME + '" tidak ditemukan. Cek nama tab di SHEET_NAME.');
    }

    // ── DEDUPE: kalau record_id ini SUDAH pernah kesimpen sebelumnya (mis.
    // percobaan pertama sebenarnya sukses appendRow, tapi browser gagal
    // nerima JSON-nya lalu user klik retry), jangan appendRow lagi — cukup
    // anggap sukses. TextFinder dipakai (bukan loop manual) biar tetap cepat
    // walau sheet-nya sudah ribuan baris.
    if (recordId) {
      const finder = sheet.getRange(1, RECORD_ID_COL, sheet.getMaxRows(), 1)
        .createTextFinder(recordId)
        .matchEntireCell(true);
      const existing = finder.findNext();
      if (existing) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: true, duplicate: true }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Urutan kolom HARUS sama persis dengan header sheet:
    // TANGGAL | PIC_MARSUP | PIC_SALES | KEYWORD | REKANAN | CUSTOMER | DISTRIBUTOR | KATEGORI | VALUE | NOTES | LINK | RECORD_ID
    sheet.appendRow([
      data.tanggal ? new Date(data.tanggal) : new Date(),
      data.pic_marsup || '',
      data.pic_sales || '',
      data.keyword || '',
      data.rekanan || '',
      data.customer || '',
      data.distributor || '',
      data.kategori || '',
      data.value || 0,
      data.notes || '',
      data.link || '',
      recordId
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Fungsi ini opsional, cuma buat testing manual dari editor Apps Script
 * (klik Run > testAppend), supaya kamu bisa cek apakah appendRow + dedupe
 * jalan tanpa perlu lewat fetch dari browser dulu. Jalanin dua kali —
 * yang kedua harusnya balikin {ok:true, duplicate:true} tanpa baris baru.
 */
function testAppend() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        tanggal: '2026-07-06',
        pic_marsup: 'Jamal',
        pic_sales: 'Budi',
        keyword: 'RSUD Dr. Soetomo',
        rekanan: 'RSUD Dr. Soetomo',
        customer: 'RSUD Dr. Soetomo',
        distributor: 'RSUD Dr. Soetomo',
        kategori: 'Unit',
        value: 15000000,
        notes: 'Testing dari Apps Script editor',
        link: '',
        record_id: 'test-record-id-001'
      })
    }
  };
  const result = doPost(fakeEvent);
  Logger.log(result.getContent());
}
