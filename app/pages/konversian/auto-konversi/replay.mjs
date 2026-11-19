#!/usr/bin/env node
// replay.mjs — ukur akurasi mesin terhadap keputusan staff di masa lalu (tanpa UI).
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=<service_role atau JWT user> \
//   node replay.mjs eval.json [--katalog-saja] [--lexicon] [--limit=200]
//
// eval.json = hasil Q5 di README/auto-konversi-queries.sql: [{ raw_text, matched_kode_produk }, ...]
//
// Dictionary: bila eval.json memuat `id`, tiap item dikeluarkan dari riwayat saat dinilai (p_exclude_item = leave-one-out),
//             jadi hasilnya tidak lagi bocor ke keputusan item itu sendiri. Teks yang sama dari item LAIN tetap terhitung
//             (itu perilaku nyata di produksi). Tanpa `id`, hasil Dictionary menggelembung.
// --katalog-saja : lewati Dictionary sama sekali; ukuran paling ketat untuk kemampuan menebak item yang belum pernah ada.
// --lexicon      : pakai get_kamus_token (agak bocor juga: kamus dibangun dari riwayat yang sama).
//
// Keluaran: top-1 / top-5 hit rate dan, per status, berapa yang top-1-nya benar.
// AUTO yang salah adalah angka terpenting — targetnya nol.
import { readFileSync } from 'node:fs';
import { parseRequestText, resolveItems, loadLexicon } from './index.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('pemakaian: node replay.mjs eval.json [--katalog-saja] [--lexicon] [--limit=N]'); process.exit(1); }
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
if (!url || !key) { console.error('isi SUPABASE_URL dan SUPABASE_KEY'); process.exit(1); }
const katalogSaja = flags.includes('--katalog-saja'), pakaiLexicon = flags.includes('--lexicon');
const limit = Number((flags.find((f) => f.startsWith('--limit=')) || '').split('=')[1]) || Infinity;

const rpc = async (name, params) => {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` }, body: JSON.stringify(params)
  });
  const body = await res.json().catch(() => null);
  return res.ok ? { data: body } : { error: body || { message: `HTTP ${res.status}` } };
};

const rows = JSON.parse(readFileSync(file, 'utf8')).slice(0, limit);
const parsed = rows.map((r) => ({ r, item: parseRequestText(`${String(r.raw_text).replace(/\t/g, ' ')}\t1`).items[0] })).filter((x) => x.item);
parsed.forEach((x) => { if (x.r.id != null) x.item.excludeId = x.r.id; });
const items = parsed.map((x) => x.item), gold = parsed.map((x) => x.r.matched_kode_produk);
const lexicon = pakaiLexicon ? await loadLexicon(rpc) : undefined;
if (pakaiLexicon) console.log(`lexicon: ${lexicon.size} token${lexicon.error ? ' (error: ' + lexicon.error + ')' : ''}`);

const res = await resolveItems(items, rpc, {
  dictionary: !katalogSaja, lexicon, concurrency: 4,
  onProgress: (n, t) => { if (n === t || n % 25 === 0) process.stderr.write(`\r${n}/${t}`); }
});
process.stderr.write('\n');

const stat = { AUTO: { n: 0, benar: 0 }, REVIEW: { n: 0, benar: 0 }, UNKNOWN: { n: 0, benar: 0 } };
let top1 = 0, top5 = 0; const salah = [];
res.forEach((r, i) => {
  const h = r.hasil, g = gold[i];
  const ok1 = h.kode_produk === g, ok5 = (h.candidates || []).slice(0, 5).some((c) => c.kode === g);
  stat[h.status].n++; if (ok1) { stat[h.status].benar++; top1++; } if (ok5) top5++;
  if (h.status === 'AUTO' && !ok1) salah.push({ teks: items[i].nama, usulan: h.kode_produk, seharusnya: g, alasan: h.reason });
});
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log(`\nmode: ${katalogSaja ? 'katalog saja (tanpa Dictionary)' : 'Dictionary + katalog (leave-one-out bila eval.json memuat id)'}`);
console.log(`item: ${items.length}   top-1: ${pct(top1, items.length)}   top-5: ${pct(top5, items.length)}`);
for (const [st, v] of Object.entries(stat)) console.log(`  ${st.padEnd(8)} ${String(v.n).padStart(4)} item   top-1 benar ${pct(v.benar, v.n)}`);
if (salah.length) { console.log(`\nAUTO YANG SALAH (${salah.length}) — ini yang harus nol:`); salah.slice(0, 20).forEach((x) => console.log(' ', JSON.stringify(x))); }
