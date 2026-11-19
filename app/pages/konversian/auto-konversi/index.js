// auto-konversi — PoC "Draft Konversi Otomatis" permintaan RS.
// Pure ES module (tanpa DOM/Supabase). Belum dipasang ke UI; lihat README/auto-konversi.md.
export { parseRequestText, parseLine, extractSpecs, buildVariants, parsePriceShorthand } from './parser.js';
export { parseCompetitorSet, competitorQueries, coreName, splitEponym } from './competitor.js';
export { resolveItem, resolveItems, summarize, pickBestCand, candConf, isAmbiguous, familyOf } from './resolver.js';
export { notUsableReason, makeFirmCheck } from './firm.js';