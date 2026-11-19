#!/usr/bin/env node
// Coba parser dari terminal (tanpa DB, tanpa UI):
//   node app/pages/konversian/auto-konversi/cli.mjs request  <file | ->     # teks permintaan RS (paste Excel/WA)
//   node app/pages/konversian/auto-konversi/cli.mjs competitor <file | ->   # teks set kompetitor (pdftotext -layout)
// "-" = baca dari stdin.  Contoh: pbpaste | node .../cli.mjs request -
import { readFileSync } from 'node:fs';
import { parseRequestText, parseCompetitorSet } from './index.js';

const [mode, src] = process.argv.slice(2);
if (!['request', 'competitor'].includes(mode) || !src) {
  console.error('Pemakaian: cli.mjs <request|competitor> <file|->');
  process.exit(1);
}
const text = readFileSync(src === '-' ? 0 : src, 'utf8');

if (mode === 'request') {
  const r = parseRequestText(text);
  console.table(r.items.map(i => ({
    nama: i.nama, qty: i.qty, 'dari baris': i.source_lines.join(','),
    ukuran_cm: i.specs.ukuran_cm, bentuk: i.specs.orientasi, varian: i.variants.slice(1).join(' | ')
  })));
  console.log(`${r.items.length} item, total qty ${r.totalQty}, ${r.skipped.length} baris disaring`);
  r.warnings.forEach(w => console.log('⚠', w));
} else {
  const r = parseCompetitorSet(text);
  console.log(`SET: ${r.setName}  |  ${r.items.length} item, total qty ${r.totalQtyParsed}`);
  console.table(r.items.map(i => ({
    no: i.no, kode: i.kode_kompetitor, qty: i.qty, inti: i.core, cm: i.specs.ukuran_cm, bentuk: i.specs.orientasi, 'query#1': i.queries[0]
  })));
  r.checks.forEach(c => console.log(c.ok === true ? '✔' : c.ok === false ? '✘' : '·', c.msg));
  if (r.unparsed.length) console.log('Baris tak terbaca:', r.unparsed);
}
