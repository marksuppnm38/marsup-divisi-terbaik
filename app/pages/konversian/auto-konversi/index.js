// auto-konversi — PoC "Draft Konversi Otomatis" permintaan RS.
// Pure ES module (tanpa DOM/Supabase). Belum dipasang ke UI; lihat README/auto-konversi.md.
export { parseRequestText, parseLine, extractSpecs, buildVariants, parsePriceShorthand } from './parser.js';
export { parseCompetitorSet, competitorQueries, coreName, splitEponym } from './competitor.js';
export { resolveItem, resolveItems, summarize, pickBestCand, cocokKonteks, KONTEKS, candConf, isAmbiguous, familyOf, buildBundle } from './resolver.js';
export { understand, compareAttrs, describeDiff, DECISIVE } from './understand.js';
export { loadLexicon, makeLexicon, buildQueryLadder, lexiconHits, EMPTY_LEXICON } from './lexicon.js';
export { assessProduk, makeFirmCheck } from './firm.js';
export { buatIndeks, uraiNama } from './prosedur.js';
export { saudaraJangkar, hitungSaudara, susunTawaran, labelOpsi, adaSpesifik, JANGKAR_MAX } from './jangkar.js';
export { ringkasProsedur, temuan, brandKosong, prefixKode, keTsv } from './prosedur-review.js';
