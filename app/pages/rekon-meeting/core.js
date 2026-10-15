// app/pages/rekon-meeting/core.js
// ─────────────────────────────────────────────────────────────────────────────
// Logika murni modul "Rekon Meeting": TANPA DOM, TANPA fetch, TANPA import.
// Sengaja begitu supaya bisa diuji di Node dengan data nyata (lihat catatan di
// index.js) dan supaya modul ini bisa dibuang tanpa meninggalkan jejak.
//
// ALUR:  recap xlsx --parseRecap--> prospek[]
//        sesi/record/SPH dari Supabase --prepareSessions--> sesi[]
//        analyze(prospek, sesi, overrides, opts) --> hasil per prospek + "belum dibahas"
//
// PRINSIP PENCOCOKAN (kenapa bukan sekadar ilike '%kata%'):
//   - Nama di sistem itu free-text: kadang nama RS ("RSUD Pandega"), kadang nama
//     rekanan ("Rekanan PT GMM"), kadang pricelist/cek stok. Pencocokan hanya
//     SARAN — user bisa centang/ubah kata kunci di layar, dan itu menang.
//   - Token yang jarang muncul di nama sesi (mis. "kandou") lebih berbobot
//     daripada yang umum ("utara", "gorontalo") — bobot idf dihitung dari
//     korpus nama sesi yang lagi dimuat.
//   - Typo ringan ditoleransi (Citrowardoyo ~ Tjitrowardoyo, Hileiva ~ Hilleiva).
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  nilaiTolPct: 15,                // selisih nilai di atas ini = "nilai beda"
  stagnanHari: 14,                // sesi tertaut tak bergerak selama ini = stagnan
  targetDekatHari: 30,            // ...padahal target klik dalam jendela ini
  belumDibahasHari: 60,
  belumDibahasMinNilai: 100_000_000,
};

// ── teks ────────────────────────────────────────────────────────────────────
export function normText(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[’'`]/g, '')          // Nu'mang -> numang, Syafi'i -> syafii
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().replace(/\s+/g, ' ');
}
const tokenize = (s) => normText(s).split(' ').filter(Boolean);

const STOP = new Set(('rsud rsup rsu rsd rs rsia rsab rso rsk rsn rsmh rumah sakit dr drs dra prof hj kab kabupaten kota prov provinsi ' +
  'dinkes dinas kesehatan pt cv ud rekanan rek paket set samaya meto pnm unit dan atau yang dengan untuk jalur mitra ' +
  'pak bu mas mbak bang bapak ibu apbd murni perubahan tahun').split(' '));
// "mitra" ada di STOP supaya "Mitra/Rekanan" tidak jadi kata kunci, TAPI "PT Global Mitra Medika"
// tetap ketangkap lewat akronim (gmm) — lihat autoKeywords().

const ALIAS = {
  kaltim: 'kalimantan timur', kaltara: 'kalimantan utara', kalsel: 'kalimantan selatan', kalbar: 'kalimantan barat',
  kalteng: 'kalimantan tengah', sulsel: 'sulawesi selatan', sulbar: 'sulawesi barat', sulut: 'sulawesi utara',
  sulteng: 'sulawesi tengah', sultra: 'sulawesi tenggara', labura: 'labuhan batu utara', polman: 'polewali mandar',
  sumbar: 'sumatera barat', sumut: 'sumatera utara', sumsel: 'sumatera selatan', jatim: 'jawa timur',
  jateng: 'jawa tengah', jabar: 'jawa barat', ntb: 'nusa tenggara barat', ntt: 'nusa tenggara timur',
};

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// a = kata kunci, b = token sesi.  Token pendek (<5) harus persis, kecuali yang
// satu mengandung yang lain dan panjangnya >= 4 (aloe ~ aloei).
function tokMatch(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if ((a.includes(b) || b.includes(a)) && Math.min(la, lb) >= 4 && Math.abs(la - lb) <= 2) return true;
  if (la < 5 || lb < 5) return false;
  const maxd = Math.min(la, lb) >= 9 ? 2 : 1; // 2 salah huruf cuma buat kata panjang (malang != magelang)
  return lev(a, b, maxd) <= maxd;
}

// ── klasifikasi nama sesi ───────────────────────────────────────────────────
const RE_PRICELIST = /\b(pricelist|price list|cek stok|check stok|cek ketersediaan|ketersediaan stok)\b/;
const RE_REKANAN = /(^|\s)(rekanan|rek|pt|cv|ud)(\s|$)/;
const RE_RS = /(^|\s)(rs[a-z]{0,4}|rumah sakit|dinkes|dinas kesehatan|puskesmas|labkesda|bapelkes)(\s|$)/;

export function classifyName(nama) {
  const t = normText(nama);
  return {
    kind: RE_PRICELIST.test(t) ? 'pricelist' : (RE_REKANAN.test(t) ? 'rekanan' : 'instansi'),
    hasRs: RE_RS.test(t),
  };
}

// ── pic / sales ─────────────────────────────────────────────────────────────
const HONORIFIC = /\b(mas|mbak|bang|pak|bu|bapak|ibu|sdr|sdri|kak)\b/g;
const PIC_ALIAS = { fredy: 'freddy', frady: 'freddy', freddi: 'freddy' };
export function picKeys(raw) {
  return String(raw || '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s*(?:&|\/|,| dan )\s*/)
    .map((p) => normText(p.replace(HONORIFIC, ' ')).split(' ')[0] || '')
    .filter(Boolean)
    .map((k) => PIC_ALIAS[k] || k);
}
export const salesKey = (raw) => picKeys(raw)[0] || '';
export function titleCase(s) { return String(s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase()); }

// ── parse recap xlsx ────────────────────────────────────────────────────────
const MONTHS = { jan: 0, januari: 0, feb: 1, februari: 1, mar: 2, maret: 2, apr: 3, april: 3, mei: 4, jun: 5, juni: 5, jul: 6, juli: 6,
  agu: 7, agt: 7, agustus: 7, ags: 7, sep: 8, sept: 8, september: 8, okt: 9, oktober: 9, nov: 10, november: 10, des: 11, desember: 11 };
const MONTH_RE = '(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|agt|ags|sept|sep|okt|nov|des)';
const eom = (y, m) => new Date(Date.UTC(y, m + 1, 0));
const mk = (y, m, d) => new Date(Date.UTC(y, m, d));

export function findMeetingDate(rowsBySheet) {
  const re = new RegExp('(\\d{1,2})\\s+' + MONTH_RE + '\\s+(\\d{4})', 'i');
  for (const rows of rowsBySheet) {
    for (const r of rows.slice(0, 6)) for (const c of r || []) {
      const m = typeof c === 'string' && c.match(re);
      if (m) return mk(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    }
  }
  return null;
}

// "Estimasi Klik" (teks bebas) -> tanggal paling lambat yang disebut. null kalau tak terbaca.
export function parseEstimasi(text, ta, meetingDate) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return null;
  const year = (t.match(/\b(20\d{2})\b/) || [])[1] ? +t.match(/\b(20\d{2})\b/)[1] : (ta || (meetingDate || new Date()).getUTCFullYear());
  const dm = [...t.matchAll(new RegExp('(?<![\\w-])(\\d{1,2})\\s*(?:-\\s*(\\d{1,2})\\s*)?' + MONTH_RE, 'g'))];
  if (dm.length) {
    const m = dm[dm.length - 1];
    return mk(year, MONTHS[m[3]], +(m[2] || m[1]));
  }
  if (/pekan (ini|berjalan)|minggu (ini|berjalan)/.test(t) && meetingDate) return new Date(meetingDate.getTime() + 6 * 864e5);
  const months = [...t.matchAll(new RegExp(MONTH_RE, 'g'))].map((x) => MONTHS[x[1]]);
  if (!months.length) return /awal\s+20\d{2}/.test(t) ? mk(year, 0, 31) : null;
  const mo = months[months.length - 1];
  const weeks = [...t.matchAll(/(?:minggu ke-?|\bw)(\d)/g)].map((x) => +x[1]);
  if (/awal/.test(t)) return mk(year, mo, 10);
  if (weeks.length) return mk(year, mo, Math.min(Math.max(...weeks) * 7, eom(year, mo).getUTCDate()));
  return eom(year, mo);
}

const HEAD_RULES = [ // urutan = prioritas (nilai sebelum item, karena "Nilai Project / Item")
  ['tim', /^tim\b/], ['ta', /tahun anggaran/], ['nilai', /nilai/], ['est', /estimasi|realisasi/],
  ['instansi', /instansi|^rs\b/], ['pic', /\bpic\b/], ['mitra', /mitra|rekanan|jalur/],
  ['status', /status|action/], ['item', /item|produk/], ['no', /^no\.?$/],
];

function mapHeader(row) {
  const col = {};
  (row || []).forEach((h, i) => {
    const t = normText(h);
    if (!t) return;
    for (const [k, re] of HEAD_RULES) if (!(k in col) && re.test(t)) { col[k] = i; break; }
  });
  return col;
}
const num = (v) => {
  if (typeof v === 'number') return v;
  const s = String(v || '').replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// rowsBySheet: [{ name, rows:[[...]] }]  (rows = sheet_to_json header:1)
export function parseRecap(rowsBySheet) {
  const master = rowsBySheet.find((s) => /master/i.test(s.name));
  const sheets = master ? [master] : rowsBySheet.filter((s) => /hot prospek/i.test(s.name));
  const meetingDate = findMeetingDate(rowsBySheet.map((s) => s.rows));
  const prospects = [];
  const warnings = [];
  for (const sh of sheets) {
    let hi = -1, col = null;
    for (let i = 0; i < Math.min(sh.rows.length, 20); i++) {
      const c = mapHeader(sh.rows[i]);
      if ('instansi' in c && 'nilai' in c) { hi = i; col = c; break; }
    }
    if (hi < 0) { warnings.push(`Sheet "${sh.name}": header tidak ditemukan (butuh kolom RS/Instansi dan Nilai).`); continue; }
    const timFromSheet = (sh.name.match(/\b(meto|samaya)\b/i) || [])[1];
    for (const r of sh.rows.slice(hi + 1)) {
      const instansi = String(r[col.instansi] ?? '').trim();
      const nilai = num(r[col.nilai]);
      if (!instansi || /total/i.test(instansi) || nilai == null) continue;
      const tim = titleCase(String(col.tim != null ? r[col.tim] : (timFromSheet || '')).trim().toLowerCase()) || 'Tanpa tim';
      const taRaw = col.ta != null ? String(r[col.ta] ?? '') : '';
      const ta = +(taRaw.match(/(20\d{2})/) || [])[1] || null;
      const est = col.est != null ? String(r[col.est] ?? '').trim() : '';
      const p = {
        tim, ta, instansi, nilai,
        item: col.item != null ? String(r[col.item] ?? '').trim() : '',
        est,
        estTgl: parseEstimasi(est, ta, meetingDate),
        pic: col.pic != null ? String(r[col.pic] ?? '').trim() : '',
        mitra: col.mitra != null ? String(r[col.mitra] ?? '').trim() : '',
        status: col.status != null ? String(r[col.status] ?? '').trim() : '',
      };
      p.picKeys = picKeys(p.pic);
      p.key = [p.tim, p.ta || '', normText(p.instansi), p.picKeys[0] || ''].join('|');
      prospects.push(p);
    }
  }
  if (!prospects.length && !warnings.length) warnings.push('Tidak ada baris prospek yang terbaca.');
  return { prospects, meetingDate, warnings, sheetDipakai: sheets.map((s) => s.name) };
}

// ── kata kunci ──────────────────────────────────────────────────────────────
function kwFor(token) { return { alts: ALIAS[token] ? [token, ALIAS[token]] : [token] }; }
const keepTok = (t, min) => t.length >= min && !STOP.has(t) && !/^\d+$/.test(t);

export function autoKeywords(instansi) {
  const raw = String(instansi || '');
  const paren = (raw.match(/\(([^)]*)\)/g) || []).map((x) => x.slice(1, -1)).join(' ');
  const main = raw.replace(/\([^)]*\)/g, ' ');
  const groups = main.split(/\s*&\s*|\s+dan\s+|\s*\/\s*/i).map((part) => {
    const all = tokenize(part);
    const toks = all.filter((t) => keepTok(t, 3));
    const sig = all.filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !['pt', 'cv', 'ud'].includes(t));
    // akronim dari nama panjang ("Global Mitra Medika" -> gmm), hanya kalau >= 3 kata bermakna
    const acronym = sig.length >= 3 && sig.length <= 5 ? sig.map((t) => t[0]).join('') : null;
    return { kws: toks.map(kwFor), acronym };
  }).filter((g) => g.kws.length);
  const sec = tokenize(paren).filter((t) => keepTok(t, 4)).map(kwFor);
  return { mode: 'auto', groups, sec, isCompany: /^\s*(pt|cv)\b/i.test(raw) };
}

export function manualKeywords(text) {
  const items = String(text || '').split(/[,;\n]/).map((s) => tokenize(s)).filter((a) => a.length);
  return { mode: 'manual', items };
}

export function keywordLabel(kw) {
  if (kw.mode === 'manual') return kw.items.map((a) => a.join(' ')).join(', ');
  const out = [];
  kw.groups.forEach((g) => { g.kws.forEach((k) => out.push(k.alts[0])); if (g.acronym) out.push(g.acronym); });
  return out.join(', ');
}

// ── sesi ────────────────────────────────────────────────────────────────────
const latestBy = (arr, keyFn) => arr.reduce((a, b) => (keyFn(b) > keyFn(a) ? b : a));

// raw: baris sesi_konversi;  records: konversi_record;  sphs: sph_records
export function prepareSessions(raw, records, sphs) {
  const recBySesi = new Map();
  for (const r of records || []) { if (!r.sesi_id) continue; if (!recBySesi.has(r.sesi_id)) recBySesi.set(r.sesi_id, []); recBySesi.get(r.sesi_id).push(r); }
  const sphBySesi = new Map();
  for (const s of sphs || []) { if (!s.sesi_id) continue; if (!sphBySesi.has(s.sesi_id)) sphBySesi.set(s.sesi_id, []); sphBySesi.get(s.sesi_id).push(s); }
  return (raw || []).map((s) => {
    const nama = String(s.nama_rs || '').trim();
    const text = normText(nama);
    const toks = text.split(' ').filter(Boolean);
    const variants = [...toks];
    for (let i = 0; i < toks.length - 1; i++) variants.push(toks[i] + toks[i + 1]);
    const recs = recBySesi.get(s.id) || [];
    const rec = recs.length ? latestBy(recs, (r) => +r.revisi || 0) : null;
    const sp = sphBySesi.get(s.id) || [];
    const spLast = sp.length ? latestBy(sp, (x) => new Date(x.created_at).getTime() + (+x.revisi || 0)) : null;
    const nilaiRec = rec && rec.grand_total != null ? +rec.grand_total : null;
    const nilaiSph = spLast && spLast.total_value != null ? +spLast.total_value : null;
    return {
      id: s.id, nama, text: ' ' + text + ' ', variants, group: text,
      sales: String(s.nama_sales || '').trim(), salesKey: salesKey(s.nama_sales),
      status: s.hasil_order || 'menunggu',
      updated: new Date(s.updated_at || s.created_at),
      nilai: nilaiSph != null ? nilaiSph : nilaiRec,
      nilaiSumber: nilaiSph != null ? 'SPH' : (nilaiRec != null ? 'record' : null),
      nilaiRecord: nilaiRec, nilaiSph,
      nSph: sp.length, noSph: spLast ? spLast.no_sph : null,
      kategori: rec ? rec.kategori : null,
      ...classifyName(nama),
    };
  });
}

const STAGE = { menunggu: 0, tanpa_order: 0, jadi_sph: 1, klik_ekat: 2, jadi_order: 3 };
export const STATUS_LABEL = { menunggu: 'Menunggu', tanpa_order: 'Tanpa order', jadi_sph: 'Jadi SPH', klik_ekat: 'Klik e-Kat', jadi_order: 'Jadi order' };

// ── pencocokan ──────────────────────────────────────────────────────────────
function makeMatcher(sessions) {
  const N = sessions.length || 1;
  const cache = new Map();
  const altHit = (alt, s) => (alt.includes(' ') ? s.text.includes(' ' + alt + ' ') : s.variants.some((v) => tokMatch(alt, v)));
  const kwHit = (kw, s) => kw.alts.some((a) => altHit(a, s));
  const dfOf = (kw) => {
    const k = kw.alts.join('|');
    if (!cache.has(k)) cache.set(k, sessions.reduce((n, s) => n + (kwHit(kw, s) ? 1 : 0), 0));
    return cache.get(k);
  };
  const wt = (df) => Math.log((N + 1) / (df + 1)) + 0.1;

  function groupCov(g, s) {
    if (g.acronym && s.variants.includes(g.acronym)) return { full: true, cov: 1, top: true };
    const act = g.kws.map((k) => ({ k, df: dfOf(k) })).filter((x) => x.df > 0);
    if (!act.length) return { full: false, cov: 0, top: false };
    let tot = 0, got = 0, topW = -1, top = false, hits = 0;
    for (const x of act) {
      const w = wt(x.df), m = kwHit(x.k, s);
      tot += w; if (m) { got += w; hits++; }
      if (w > topW) { topW = w; top = m; }
    }
    return { full: hits === act.length, cov: got / tot, top };
  }

  // -> { conf:'tinggi'|'sedang'|'rendah', skor } | null
  function match(kw, s) {
    if (kw.mode === 'manual') {
      const ok = kw.items.some((words) => words.every((w) => altHit(w, s)));
      return ok ? { conf: 'tinggi', skor: 4 } : null;
    }
    let best = null;
    for (const g of kw.groups) {
      const c = groupCov(g, s);
      if (c.full) { best = { conf: 'tinggi', skor: 3 + c.cov }; break; }
      if (c.cov >= 0.5 && c.top && (!best || 2 + c.cov > best.skor)) best = { conf: 'sedang', skor: 2 + c.cov };
    }
    // Fallback kata di dalam kurung (mis. "A. Syafi'i Ma'arif" buat Sijunjung): HANYA kalau nama utamanya sama sekali
    // tak pernah muncul di sistem. Kalau tidak, nama kota ikut menarik sesi RS lain.
    const utamaAda = kw.groups.some((g) => g.kws.some((k) => dfOf(k) > 0));
    if (!best && !utamaAda && kw.sec.length && kw.sec.every((k) => dfOf(k) > 0 && dfOf(k) <= 3 && kwHit(k, s))) best = { conf: 'sedang', skor: 2 };
    if (best && best.conf === 'tinggi' && s.kind === 'rekanan' && !s.hasRs && !kw.isCompany) best = { conf: 'rendah', skor: 1 + best.skor / 10 };
    return best;
  }
  return { match };
}

// ── analisis utama ──────────────────────────────────────────────────────────
// overrides: { kw:{[key]:string}, inc:{[key]:{[sesiId]:bool}}, hit:{[key]:{[sesiId]:bool}}, pen:{[key]:string} }
// opts: { today:Date, timDibandingkan:string[] (lowercase), ...DEFAULTS }
export function analyze(prospects, sessions, overrides = {}, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const today = o.today || new Date();
  const tdy = mk(today.getFullYear(), today.getMonth(), today.getDate());
  const bandingkan = new Set((o.timDibandingkan || ['samaya']).map((x) => x.toLowerCase()));
  const M = makeMatcher(sessions);
  const ov = { kw: {}, inc: {}, hit: {}, pen: {}, ...overrides };

  // 1. kandidat per prospek
  const results = prospects.map((p) => {
    const kwText = ov.kw[p.key];
    const kw = kwText != null && String(kwText).trim() ? manualKeywords(kwText) : autoKeywords(p.instansi);
    const dibandingkan = bandingkan.has(String(p.tim).toLowerCase());
    const cands = [];
    if (dibandingkan) for (const s of sessions) { const m = M.match(kw, s); if (m) cands.push({ s, ...m, include: false, hitung: true, dobel: null }); }
    cands.sort((a, b) => b.skor - a.skor || b.s.updated - a.s.updated);
    return { p, kw, kwManual: kw.mode === 'manual', dibandingkan, cands };
  });

  // 2. default include: tinggi (bukan pricelist); 'sedang' hanya kalau tak ada yang tinggi
  for (const r of results) {
    const tinggi = r.cands.filter((c) => c.conf === 'tinggi' && c.s.kind !== 'pricelist');
    for (const c of r.cands) {
      if (c.s.kind === 'pricelist') continue;
      if (c.conf === 'tinggi') c.include = true;
      else if (c.conf === 'sedang' && !tinggi.length) c.include = true;
    }
  }
  // 3. satu sesi hanya boleh jadi milik satu prospek (yang skornya tertinggi)
  const owners = new Map();
  for (const r of results) for (const c of r.cands) if (c.include) {
    const cur = owners.get(c.s.id);
    if (!cur || c.skor > cur.c.skor) owners.set(c.s.id, { r, c });
  }
  for (const r of results) for (const c of r.cands) if (c.include && owners.get(c.s.id).c !== c) {
    c.include = false; c.dobel = owners.get(c.s.id).r.p.instansi;
  }
  // 4. override user + default "hitung" (iterasi bernama sama: hanya yang terbaru)
  for (const r of results) {
    const inc = ov.inc[r.p.key] || {}, hit = ov.hit[r.p.key] || {};
    for (const c of r.cands) if (c.s.id in inc) c.include = !!inc[c.s.id];
    const seen = new Map();
    for (const c of r.cands.filter((x) => x.include).sort((a, b) => b.s.updated - a.s.updated)) {
      c.hitung = !seen.has(c.s.group); seen.set(c.s.group, true);
    }
    for (const c of r.cands) if (c.s.id in hit) c.hitung = !!hit[c.s.id];
  }
  // 5. evaluasi tiap prospek
  for (const r of results) evaluate(r, o, tdy, ov);

  const belum = o.belumDibahasHari ? belumDibahas(sessions, results, o, tdy) : [];
  return { results, belum, summary: summarize(results, belum) };
}

const daysBetween = (a, b) => Math.round((a.getTime() - b.getTime()) / 864e5);

function evaluate(r, o, tdy, ov) {
  const { p } = r;
  r.penjelasan = ov.pen[p.key] || '';
  r.chips = [];
  r.tertaut = r.cands.filter((c) => c.include);
  const hitung = r.tertaut.filter((c) => c.hitung && c.s.nilai != null);
  r.nilaiSum = hitung.length ? hitung.reduce((a, c) => a + c.s.nilai, 0) : null;
  const vals = r.tertaut.filter((c) => c.s.nilai != null).map((c) => c.s.nilai);
  r.nilaiMax = vals.length ? Math.max(...vals) : null;
  r.statusSistem = r.tertaut.length ? r.tertaut.reduce((a, c) => ((STAGE[c.s.status] ?? 0) > (STAGE[a] ?? 0) ? c.s.status : a), 'menunggu') : null;
  r.update = r.tertaut.length ? new Date(Math.max(...r.tertaut.map((c) => c.s.updated.getTime()))) : null;
  r.nSph = r.tertaut.reduce((n, c) => n + c.s.nSph, 0);
  r.selisih = r.nilaiSum != null && p.nilai ? r.nilaiSum - p.nilai : null;
  r.selisihPct = r.selisih != null && p.nilai ? (r.selisih / p.nilai) * 100 : null;
  if (!r.dibandingkan) { r.verdict = 'skip'; return; }

  const add = (id, label, level, detail) => r.chips.push({ id, label, level, detail });
  const stage = STAGE[r.statusSistem] ?? 0;

  if (!r.cands.length) add('tanpa-jejak', 'Tanpa jejak', 'bad', 'Tidak ada sesi di sistem yang namanya cocok dengan prospek ini.');
  else if (!r.tertaut.length) add('belum-tertaut', 'Belum ditautkan', 'info', `${r.cands.length} sesi mirip, belum ada yang dicentang.`);

  if (r.tertaut.length) {
    if (r.nilaiSum == null) add('belum-record', 'Belum ada nilai', 'info', 'Sesi tertaut belum di-Record / belum punya SPH, jadi tidak ada nilai buat dibandingkan.');
    else if (p.nilai) {
      // Klop kalau angka meeting dekat dengan SALAH SATU: jumlah, sesi terbesar, atau satu sesi tertaut
      // (iterasi lama bernama beda sering ikut tertaut; satu sesi yang pas sudah cukup menjelaskan).
      const dekat = (v) => Math.abs(v - p.nilai) / p.nilai * 100 <= o.nilaiTolPct;
      const satu = r.tertaut.find((c) => c.s.nilai != null && dekat(c.s.nilai));
      if (satu && !dekat(r.nilaiSum) && !dekat(r.nilaiMax)) r.nilaiNote = `Cocok dengan satu sesi: ${satu.s.nama} (${fmtRp(satu.s.nilai)}).`;
      if (!dekat(r.nilaiSum) && !dekat(r.nilaiMax) && !satu) {
        const near = Math.abs(r.nilaiSum - p.nilai) <= Math.abs(r.nilaiMax - p.nilai) ? r.nilaiSum : r.nilaiMax;
        const rasio = near / p.nilai;
        add('nilai', 'Nilai beda', rasio < 0.25 || rasio > 2 ? 'bad' : 'warn',
          `Meeting ${fmtRp(p.nilai)}, sistem ${fmtRp(r.nilaiSum)} (sesi terbesar ${fmtRp(r.nilaiMax)}). Selisih ${fmtSigned(r.nilaiSum - p.nilai)}.`);
      }
    }
    if (p.picKeys.length && !r.tertaut.some((c) => p.picKeys.includes(c.s.salesKey))) {
      const ada = [...new Set(r.tertaut.map((c) => c.s.sales).filter(Boolean))].join(', ') || '(kosong)';
      add('pic-beda', 'PIC beda', 'warn', `Meeting: ${p.pic}. Sesi di sistem atas nama: ${ada}.`);
    }
  }
  if (p.estTgl && stage < 2 && p.estTgl < tdy) {
    add('lewat-target', 'Lewat target', 'warn', `Target klik ${fmtTgl(p.estTgl)} (${p.est}), status sistem masih ${STATUS_LABEL[r.statusSistem || 'menunggu']}.`);
  }
  if (r.tertaut.length && stage < 2 && r.update && p.estTgl) {
    const diam = daysBetween(tdy, r.update), sisa = daysBetween(p.estTgl, tdy);
    if (diam > o.stagnanHari && sisa <= o.targetDekatHari && !r.chips.some((c) => c.id === 'lewat-target')) {
      add('stagnan', 'Stagnan', 'warn', `Sesi terakhir bergerak ${diam} hari lalu padahal target klik ${fmtTgl(p.estTgl)}.`);
    }
  }
  if (/\bsph\b/i.test(p.status) && r.nSph === 0 && r.tertaut.length) add('sph-klaim', 'SPH belum tercatat', 'info', 'Catatan meeting menyebut SPH, tapi belum ada SPH di sistem untuk sesi tertaut.');

  r.verdict = r.chips.some((c) => c.level === 'bad') ? 'bad' : r.chips.some((c) => c.level === 'warn') ? 'warn' : r.chips.length ? 'info' : 'klop';
}

// sesi besar yang tidak masuk prospek mana pun
function belumDibahas(sessions, results, o, tdy) {
  const dipakai = new Set();
  for (const r of results) if (r.dibandingkan) for (const c of r.cands) if (c.include || c.conf === 'tinggi') dipakai.add(c.s.id);
  const batas = tdy.getTime() - o.belumDibahasHari * 864e5;
  const grp = new Map();
  for (const s of sessions) {
    if (dipakai.has(s.id) || s.kind === 'pricelist' || s.nilai == null || s.nilai < o.belumDibahasMinNilai) continue;
    if (s.updated.getTime() < batas) continue;
    const g = grp.get(s.group) || { nama: s.nama, sales: s.sales, kind: s.kind, items: [] };
    g.items.push(s); grp.set(s.group, g);
  }
  return [...grp.values()].map((g) => {
    const last = latestBy(g.items, (s) => s.updated.getTime());
    return {
      nama: last.nama, sales: last.sales, kind: last.kind, status: last.status, nilai: last.nilai, nilaiSumber: last.nilaiSumber,
      nilaiMax: Math.max(...g.items.map((s) => s.nilai)), updated: last.updated, iterasi: g.items.length, noSph: last.noSph, nSph: last.nSph,
    };
  }).sort((a, b) => b.nilai - a.nilai);
}

function summarize(results, belum) {
  const cmp = results.filter((r) => r.dibandingkan);
  const sum = (a, f) => a.reduce((n, x) => n + (f(x) || 0), 0);
  const by = (v) => cmp.filter((r) => r.verdict === v).length;
  return {
    total: results.length, dibandingkan: cmp.length, tidakDibandingkan: results.length - cmp.length,
    nilaiTidakDibandingkan: sum(results.filter((r) => !r.dibandingkan), (r) => r.p.nilai),
    nilaiMeeting: sum(cmp, (r) => r.p.nilai), nilaiSistem: sum(cmp, (r) => r.nilaiSum),
    klop: by('klop'), selisih: by('warn') + by('bad'), cek: by('info'),
    tanpaJejak: cmp.filter((r) => r.chips.some((c) => c.id === 'tanpa-jejak')).length,
    belumDibahas: belum.length, nilaiBelumDibahas: sum(belum, (b) => b.nilai),
  };
}

// ── format ──────────────────────────────────────────────────────────────────
const nf = (n, d) => n.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
export function fmtRp(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}Rp ${nf(a / 1e9, 2)} M`;
  if (a >= 1e6) return `${s}Rp ${nf(a / 1e6, a >= 1e8 ? 0 : 1)} jt`;
  return `${s}Rp ${nf(a, 0)}`;
}
export const fmtSigned = (n) => (n > 0 ? '+' : '') + fmtRp(n);
export function fmtTgl(d) {
  if (!d) return '—';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── baris laporan (dipakai index.js untuk xlsx; murni biar bisa diuji) ──────
export function buildReport(analysis, meetingDate) {
  const { results, belum, summary } = analysis;
  const cmp = results.filter((r) => r.dibandingkan);
  const rekon = [[
    'No', 'Tim', 'TA', 'RS / Instansi', 'PIC (meeting)', 'Nilai menurut meeting (Rp)', 'Nilai menurut sistem - jumlah (Rp)',
    'Nilai sistem - sesi terbesar (Rp)', 'Selisih (Rp)', 'Selisih (%)', 'Status sistem', 'Update sistem terakhir', 'Estimasi klik (meeting)',
    'Selisih terdeteksi', 'Sesi tertaut di sistem', 'Catatan meeting', 'Penjelasan selisih',
  ]];
  cmp.forEach((r, i) => rekon.push([
    i + 1, r.p.tim, r.p.ta, r.p.instansi, r.p.pic, r.p.nilai, r.nilaiSum, r.nilaiMax, r.selisih,
    r.selisihPct == null ? null : Math.round(r.selisihPct * 10) / 10,
    r.statusSistem ? STATUS_LABEL[r.statusSistem] : '(tidak ada sesi)',
    r.update ? fmtTgl(r.update) : '', r.p.est,
    r.verdict === 'klop' ? 'Klop' : r.chips.map((c) => `${c.label}: ${c.detail}`).join(' | '),
    r.tertaut.map((c) => `${c.s.nama} [${c.s.sales || '-'}; ${STATUS_LABEL[c.s.status]}; ${c.s.nilai != null ? fmtRp(c.s.nilai) : 'tanpa nilai'}${c.hitung ? '' : '; tidak dihitung'}]`).join('\n'),
    r.p.status, r.penjelasan,
  ]));
  const bd = [['No', 'Nama di sistem', 'Sales', 'Jenis nama', 'Status', 'Nilai (Rp)', 'Sumber nilai', 'Update terakhir', 'Jumlah iterasi', 'No. SPH']];
  belum.forEach((b, i) => bd.push([i + 1, b.nama, b.sales, b.kind, STATUS_LABEL[b.status], b.nilai, b.nilaiSumber, fmtTgl(b.updated), b.iterasi, b.noSph || '']));
  const rg = [
    ['REKONSILIASI: KATA MEETING vs KATA DATA'],
    ['Tanggal meeting', meetingDate ? fmtTgl(meetingDate) : '(tidak terbaca)'],
    ['Dibuat', fmtTgl(new Date())],
    [],
    ['Prospek dibandingkan', summary.dibandingkan],
    ['Nilai menurut meeting (Rp)', summary.nilaiMeeting],
    ['Nilai menurut sistem (Rp)', summary.nilaiSistem],
    ['Klop', summary.klop],
    ['Ada selisih', summary.selisih],
    ['Perlu dicek', summary.cek],
    ['Tanpa jejak di sistem', summary.tanpaJejak],
    ['Sesi besar belum dibahas', summary.belumDibahas],
    ['Nilai sesi belum dibahas (Rp)', summary.nilaiBelumDibahas],
    [],
    ['Catatan: "Nilai sistem" = jumlah sesi tertaut yang dicentang "hitung" (iterasi bernama sama hanya diambil yang terbaru). Selisih ditandai kalau meeting berbeda > ' + DEFAULTS.nilaiTolPct + '% dari jumlah DAN dari sesi terbesar.'],
  ];
  return { rekon, belum: bd, ringkasan: rg };
}
