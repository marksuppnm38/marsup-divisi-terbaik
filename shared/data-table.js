// shared/data-table.js
// Tabel dinamis bersama: urut (sort), saring (filter) per kolom, dan kolom yang bisa dipilih / diatur urutannya.
// Dipakai tabel list di sub-modul (AKD Management, KFA Management, dst) supaya perilakunya SAMA di semua tempat,
// bukan tiap tabel menulis versi sendiri-sendiri.
//
// Dua bagian, sengaja dipisah:
//   1. MURNI (tanpa DOM / jaringan, bisa dites node --test): definisi filter, applyToQuery() untuk query Supabase
//      (server-side: sort + filter dikerjakan Postgres, jadi paging tetap benar), plus sortRows()/filterRows()
//      untuk tabel yang datanya sudah dimuat penuh di browser.
//   2. UI: createDataTable() menggambar header (klik judul -> menu urut + saring), bar chip filter aktif,
//      dan pemilih kolom. Pilihan kolom disimpan per browser (localStorage). Sort/filter hanya di memori
//      (kecuali dikirim lewat table-preset.js, mis. dari kartu dashboard).
//
// DEFINISI KOLOM
//   { key, label,
//     type:  'text' | 'enum' | 'date' | 'bool' | 'num'      (default 'text')
//     field: kolom di tabel (default = key). Kolom relasi: 'produk.kode_produk' (alias embed di select()).
//     sortable / filterable: false = mati (default hidup)
//     locked: true = selalu tampil & tetap di depan        hidden: true = tersembunyi sampai dipilih user
//     options: ['a','b'] | [{value,label}] | () => [...]   (type 'enum')
//     datePresets: [{ label, filter: { op, value } }]       (type 'date': pintasan di menu, mis. "<= 30 hari lagi")
//     sortLabels: ['label naik','label turun']              (opsional, ganti label bawaan)
//     fillFilter: false = tanpa pasangan "Sudah / Belum diisi"
//     render: (row, ctx) => html     td: kelas <td>     tdStyle: style <td>
//     get: (row) => nilai            (hanya untuk mode client: sortRows / filterRows) }
//
// OP FILTER (satu filter per kolom): contains eq in isi kosong | expired within dari sampai antara | bool
// Tanggal relatif ('within') dihitung saat query dijalankan, jadi preset "30 hari lagi" tidak pernah basi.
import { consumeTablePreset } from './table-preset.js';

// ============================================================
// 1) MURNI
// ============================================================
const pad2 = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export function addDaysISO(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

const fieldOf = (c) => c.field || c.key;
export const isJoinCol = (c) => fieldOf(c).includes('.');
const typeOf = (c) => c.type || 'text';
// 'produk.kode_produk' -> 'produk(kode_produk)' : sintaks PostgREST untuk mengurutkan induk menurut kolom relasi to-one.
const sortFieldOf = (c) => {
  if (c.sortField) return c.sortField;
  const f = fieldOf(c), i = f.indexOf('.');
  return i < 0 ? f : `${f.slice(0, i)}(${f.slice(i + 1)})`;
};

const OPS = {
  text: ['contains', 'eq', 'isi', 'kosong'],
  enum: ['in', 'isi', 'kosong'],
  date: ['expired', 'within', 'dari', 'sampai', 'antara', 'isi', 'kosong'],
  bool: ['bool'],
  num:  ['isi', 'kosong'],
};

/** Filter yang sah untuk kolom ini, atau null (dipakai untuk preset dari luar -> input tak tepercaya). */
export function normalizeFilter(col, f) {
  if (!col || !f || typeof f !== 'object') return null;
  if (col.filterable === false) return null;
  const t = typeOf(col);
  if (!(OPS[t] || []).includes(f.op)) return null;
  const out = { key: col.key, op: f.op };
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  switch (f.op) {
    case 'contains': case 'eq': { const v = String(f.value ?? '').trim(); if (!v) return null; out.value = v; break; }
    case 'in': { const v = (Array.isArray(f.value) ? f.value : []).map(String).filter((x) => x !== ''); if (!v.length) return null; out.value = v; break; }
    case 'within': { const n = Number(f.value); if (!Number.isInteger(n) || n < 0 || n > 36500) return null; out.value = n; break; }
    case 'dari': case 'sampai': { if (!isDate(f.value)) return null; out.value = f.value; break; }
    case 'antara': {
      const v = f.value || {};
      if (!isDate(v.from) || !isDate(v.to)) return null;
      out.value = v.from <= v.to ? { from: v.from, to: v.to } : { from: v.to, to: v.from };
      break;
    }
    case 'bool': out.value = f.value === true || f.value === 'true'; break;
    default: break; // isi / kosong / expired: tanpa nilai
  }
  return out;
}

const escLike = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m);

function applyFilter(q, col, f, today) {
  const fld = fieldOf(col);
  switch (f.op) {
    case 'contains': return q.ilike(fld, `%${escLike(f.value)}%`);
    case 'eq': return q.eq(fld, f.value);
    case 'in': return q.in(fld, f.value);
    case 'isi': return typeOf(col) === 'text' && !isJoinCol(col) ? q.not(fld, 'is', null).neq(fld, '') : q.not(fld, 'is', null);
    // Teks kosong bisa NULL atau ''. Kolom relasi: cukup NULL (or() tidak bisa menjangkau kolom embed tanpa referencedTable).
    case 'kosong': return typeOf(col) === 'text' && !isJoinCol(col) ? q.or(`${fld}.is.null,${fld}.eq.`) : q.is(fld, null);
    case 'expired': return q.lt(fld, today);
    case 'within': return q.gte(fld, today).lte(fld, addDaysISO(today, f.value));
    case 'dari': return q.gte(fld, f.value);
    case 'sampai': return q.lte(fld, f.value);
    case 'antara': return q.gte(fld, f.value.from).lte(fld, f.value.to);
    case 'bool': return q.eq(fld, !!f.value);
    default: return q;
  }
}

/**
 * Pasang filter + urutan ke query supabase-js (server-side). Kosong SELALU di bawah, naik maupun turun.
 * state = { sort: {key, dir}|null, filters: [{key, op, value}] }. tieBreak = kolom pembeda seri (mis. 'id')
 * supaya urutan antar-halaman stabil. Filter / urutan untuk kolom yang tak dikenal diabaikan.
 */
export function applyToQuery(query, state, columns, { tieBreak = null, today = isoDate() } = {}) {
  let q = query;
  const byKey = new Map(columns.map((c) => [c.key, c]));
  for (const f of (state.filters || [])) {
    const col = byKey.get(f.key);
    if (col && col.filterable !== false) q = applyFilter(q, col, f, today);
  }
  const sc = state.sort && byKey.get(state.sort.key);
  if (sc && sc.sortable !== false) q = q.order(sortFieldOf(sc), { ascending: state.sort.dir !== 'desc', nullsFirst: false });
  if (tieBreak && !(sc && fieldOf(sc) === tieBreak)) q = q.order(tieBreak, { ascending: true });
  return q;
}

/** Ada filter pada kolom relasi? Kalau ya, select() harus memakai `!inner` supaya filter itu menyaring baris induk. */
export function needsInner(state, columns) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  return (state.filters || []).some((f) => { const c = byKey.get(f.key); return !!c && isJoinCol(c); });
}
/** Urutan memakai kolom relasi? (dipakai pemanggil untuk fallback bila server menolak sintaks order relasi) */
export const sortUsesJoin = (state, columns) => {
  const c = state.sort && columns.find((x) => x.key === state.sort.key);
  return !!c && isJoinCol(c) && !c.sortField;
};

// ---- mode client (data sudah di browser) ----
const valOf = (col, row) => (col.get ? col.get(row) : row[col.key]);
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');

export function matchFilter(col, f, row, today = isoDate()) {
  const v = valOf(col, row);
  switch (f.op) {
    case 'contains': return String(v ?? '').toLowerCase().includes(String(f.value).toLowerCase());
    case 'eq': return String(v ?? '') === String(f.value);
    case 'in': return f.value.map(String).includes(String(v ?? ''));
    case 'isi': return !blank(v);
    case 'kosong': return blank(v);
    case 'expired': return !blank(v) && String(v).slice(0, 10) < today;
    case 'within': return !blank(v) && String(v).slice(0, 10) >= today && String(v).slice(0, 10) <= addDaysISO(today, f.value);
    case 'dari': return !blank(v) && String(v).slice(0, 10) >= f.value;
    case 'sampai': return !blank(v) && String(v).slice(0, 10) <= f.value;
    case 'antara': return !blank(v) && String(v).slice(0, 10) >= f.value.from && String(v).slice(0, 10) <= f.value.to;
    case 'bool': return !!v === !!f.value;
    default: return true;
  }
}
export function filterRows(rows, filters, columns, today = isoDate()) {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const act = (filters || []).filter((f) => byKey.has(f.key));
  return act.length ? rows.filter((r) => act.every((f) => matchFilter(byKey.get(f.key), f, r, today))) : rows;
}
export function sortRows(rows, sort, columns, tieBreak = null) {
  const col = sort && columns.find((c) => c.key === sort.key);
  if (!col || col.sortable === false) return rows;
  const t = typeOf(col), sgn = sort.dir === 'desc' ? -1 : 1;
  const cmp = (a, b) => (t === 'num' || t === 'bool') ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'id', { numeric: true });
  return [...rows].sort((ra, rb) => {
    const a = valOf(col, ra), b = valOf(col, rb);
    if (blank(a) !== blank(b)) return blank(a) ? 1 : -1; // kosong selalu di bawah
    const c = blank(a) ? 0 : cmp(a, b) * sgn;
    if (c) return c;
    return tieBreak ? String(ra[tieBreak] ?? '').localeCompare(String(rb[tieBreak] ?? ''), 'id', { numeric: true }) : 0;
  });
}

// ---- state helpers ----
export const upsertFilter = (filters, f) => [...filters.filter((x) => x.key !== f.key), f];
export const dropFilter = (filters, key) => filters.filter((x) => x.key !== key);
/** Memilih arah yang sedang aktif = mematikan urutan (seperti Sheets). */
export const nextSort = (cur, key, dir) => (cur && cur.key === key && cur.dir === dir ? null : { key, dir });

/** Gabungkan pilihan tersimpan dengan definisi kolom: kolom baru ikut muncul, kolom yang sudah dihapus dibuang. */
export function resolveColumns(columns, saved) {
  const keys = columns.map((c) => c.key);
  const known = new Set(keys);
  const savedOrder = saved && Array.isArray(saved.order) ? saved.order.filter((k) => known.has(k)) : [];
  let order = [...savedOrder, ...keys.filter((k) => !savedOrder.includes(k))];
  const locked = columns.filter((c) => c.locked).map((c) => c.key);
  order = [...locked, ...order.filter((k) => !locked.includes(k))]; // kolom terkunci tetap di depan
  const seen = new Set(savedOrder);
  const hidden = new Set();
  columns.forEach((c) => {
    if (c.locked) return;
    const wasSaved = saved && Array.isArray(saved.hidden);
    if (wasSaved && seen.has(c.key)) { if (saved.hidden.includes(c.key)) hidden.add(c.key); }
    else if (c.hidden) hidden.add(c.key); // belum pernah dilihat user -> ikut bawaan definisi
  });
  return { order, hidden };
}

/** Sel kosong yang tenang: tanda hubung redup (dipakai juga oleh render() kolom di sub-modul). */
export const NIL_HTML = '<span class="dt-nil" role="img" aria-label="Kosong">—</span>';

const fmtTgl = (iso) => {
  const d = iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00') : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : String(iso || '');
};

/** Teks ringkas satu filter untuk chip: "mengandung \"abc\"", "sampai 30 hari lagi", dst. */
export function describeFilter(col, f) {
  const preset = (col.datePresets || []).find((p) => p.filter && p.filter.op === f.op && p.filter.value === f.value);
  if (preset) return preset.chip || preset.label;
  switch (f.op) {
    case 'contains': return `mengandung “${f.value}”`;
    case 'eq': return `= ${f.value}`;
    case 'in': {
      const lab = (v) => { const o = optionList(col).find((x) => x.value === v); return o ? o.label : v; };
      return f.value.length <= 2 ? f.value.map(lab).join(', ') : `${f.value.slice(0, 2).map(lab).join(', ')} +${f.value.length - 2}`;
    }
    case 'isi': return 'sudah diisi';
    case 'kosong': return 'belum diisi';
    case 'expired': return 'sudah lewat';
    case 'within': return `≤ ${f.value} hari lagi`;
    case 'dari': return `mulai ${fmtTgl(f.value)}`;
    case 'sampai': return `sampai ${fmtTgl(f.value)}`;
    case 'antara': return `${fmtTgl(f.value.from)} – ${fmtTgl(f.value.to)}`;
    case 'bool': return f.value ? 'ya' : 'tidak';
    default: return '';
  }
}

function optionList(col) {
  const raw = typeof col.options === 'function' ? col.options() : col.options;
  return (Array.isArray(raw) ? raw : []).map((o) => (o && typeof o === 'object' ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));
}

const SORT_LABELS = {
  text: ['Urutkan A → Z', 'Urutkan Z → A'],
  enum: ['Urutkan A → Z', 'Urutkan Z → A'],
  date: ['Terlama dulu', 'Terbaru dulu'],
  num:  ['Terkecil dulu', 'Terbesar dulu'],
  bool: ['Tidak dulu', 'Ya dulu'],
};

// ============================================================
// 2) UI
// ============================================================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const LS_PREFIX = 'pnm_dt_cols_v1:';

function readPrefs(id) {
  try { const raw = localStorage.getItem(LS_PREFIX + id); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writePrefs(id, prefs) {
  try { localStorage.setItem(LS_PREFIX + id, JSON.stringify({ order: prefs.order, hidden: [...prefs.hidden] })); } catch (e) { /* storage penuh / ditolak: pilihan hanya berlaku di sesi ini */ }
}

let styleDone = false;
function injectStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  const st = document.createElement('style');
  st.id = 'pnm-dt-style';
  // :where() = spesifisitas 0 -> halaman yang sudah punya gaya .th-btn / .th-menu-pop (crud-produk) menang;
  // halaman lain tetap dapat tampilan layak dari sini.
  st.textContent = `
:where(th.th-has-menu){padding:0}
:where(.th-btn){display:inline-flex;align-items:center;gap:6px;width:100%;padding:9px 14px;border:0;background:transparent;font:inherit;color:inherit;text-align:inherit;white-space:nowrap;cursor:pointer}
:where(.th-btn:hover){background:var(--surface-3)}
:where(.th-btn.on){color:var(--accent-text)}
:where(.th-ind-idle){opacity:0}
:where(.th-btn:hover .th-ind-idle,.th-btn:focus-visible .th-ind-idle){opacity:.55}
:where(.th-fil){font-size:13px;color:var(--accent-text)}
:where(.th-menu-pop){position:fixed;z-index:70;min-width:216px;max-width:300px;padding:4px;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-md);box-shadow:var(--shadow-lg);font-size:13px;color:var(--text)}
:where(.thm-title){padding:6px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--text-muted)}
:where(.thm-item){display:flex;align-items:center;gap:9px;width:100%;padding:7px 10px;border:0;border-radius:var(--radius-sm);background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer}
:where(.thm-item:hover,.thm-item:focus-visible){background:var(--surface-2);outline:none}
:where(.thm-item i){font-size:15px;color:var(--text-muted)}
:where(.thm-item.on){color:var(--accent-text);font-weight:600}
:where(.thm-item span){flex:1}
:where(.thm-check){margin-left:auto}
:where(.thm-danger,.thm-danger i){color:var(--danger-text)}
:where(.thm-sep){height:1px;margin:4px 6px;background:var(--border)}
.dt-fin{display:flex;gap:6px;padding:4px 6px}
.dt-fin .dt-input{flex:1;min-width:0}
.dt-input{padding:6px 8px;border:1px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit}
.dt-input:focus-visible{outline:2px solid var(--accent);outline-offset:-1px}
.dt-go{padding:6px 10px;border:0;border-radius:var(--radius-sm);background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.dt-go:disabled{opacity:.45;cursor:default}
.dt-range{display:grid;grid-template-columns:auto 1fr;gap:6px 8px;align-items:center;padding:4px 10px 6px;font-size:12px;color:var(--text-muted)}
.dt-range .dt-go{grid-column:1 / -1}
.dt-opts{max-height:220px;overflow-y:auto;padding:2px 4px}
.dt-opt{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:var(--radius-sm);cursor:pointer}
.dt-opt:hover{background:var(--surface-2)}
.dt-opts-empty{padding:6px 10px;color:var(--text-muted)}
.dt-apply{padding:4px 6px 2px}
.dt-apply .dt-go{width:100%}
.dt-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}
.dt-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:0 var(--gutter,0) 10px}
.dt-chips[hidden]{display:none}
.dt-colbtn,.dt-chip,.dt-reset{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12.5px;cursor:pointer}
.dt-colbtn{height:30px;padding:0 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:transparent;color:var(--text-secondary,var(--text));font-weight:500}
.dt-colbtn:hover{background:var(--surface-2);color:var(--text)}
.dt-chip{padding:3px 6px 3px 9px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text)}
.dt-chip:hover{border-color:var(--border-strong)}
.dt-chip span{color:var(--text-muted)}
.dt-chip b{font-weight:600}
.dt-chip i{font-size:13px;color:var(--text-muted)}
.dt-chip:hover i{color:var(--text)}
.dt-reset{padding:3px 6px;border:0;border-radius:6px;background:none;color:var(--accent-text)}
.dt-reset:hover{background:var(--accent-soft)}
.dt-colbtn:focus-visible,.dt-chip:focus-visible,.dt-reset:focus-visible,.dt-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.dt-count{color:var(--text-muted);font-variant-numeric:tabular-nums}
.dt-nil{color:var(--text-muted);opacity:.55}
.dt-muted{color:var(--text-muted)}
.dt-mono{font-family:var(--font-mono);font-size:12px}
.dt-num{font-variant-numeric:tabular-nums}
.dt-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--text-muted)}
.dt-dot.is-ok{background:var(--teal-ok-text)}
.dt-dot.is-warn{background:var(--amber-text)}
.dt-dot.is-bad{background:var(--rust-text)}
.dt-state{display:inline-flex;align-items:center;gap:8px;color:var(--text-muted)}
.dt-link{padding:0;border:0;background:none;color:var(--accent-text);font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
:where(tr.clickable){cursor:pointer}
tr.clickable:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
tbody.is-loading{opacity:.45;pointer-events:none;transition:opacity .15s}
@media (prefers-reduced-motion:reduce){tbody.is-loading{transition:none}}
.dt-cols{min-width:260px}
.dt-prs{display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 6px}
.dt-pr{padding:3px 9px;border:1px solid var(--border-strong);border-radius:999px;background:var(--surface);color:var(--text);font:inherit;font-size:12px;cursor:pointer}
.dt-pr:hover{background:var(--surface-2)}
.dt-col{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:var(--radius-sm)}
.dt-col:hover{background:var(--surface-2)}
.dt-col label{flex:1;display:flex;align-items:center;gap:8px;cursor:pointer}
.dt-col.is-locked label{cursor:default;color:var(--text-muted)}
.dt-mv{width:24px;height:24px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);cursor:pointer}
.dt-mv:hover:not(:disabled){background:var(--surface-3);color:var(--text)}
.dt-mv:disabled{opacity:.3;cursor:default}
`;
  document.head.appendChild(st);
}

/**
 * opts: { id, columns, headRow (<tr> di thead), bar (elemen untuk tombol Kolom), chips (opsional: elemen terpisah
 *         untuk chip filter + Reset; disembunyikan otomatis saat kosong. Tanpa `chips`, chip ikut digambar di `bar`),
 *         onChange(), onRowClick(row, ctx), defaultSort, tieBreak, presets: [{id,label,keys:[...]}],
 *         emptyText, emptyFilteredText }
 * Tambahan API: setLoading(tbody) = redupkan baris yang sudah ada selama memuat ulang (tanpa lompatan layout);
 * kosong/pertama kali -> baris "Memuat data…". Baris yang bisa diklik juga bisa difokus + Enter/Spasi.
 * onChange() dipanggil saat sort / filter berubah (server: muat ulang halaman 1). Perubahan kolom tidak memicu
 * onChange: baris terakhir yang dimuat digambar ulang dengan kolom baru.
 */
export function createDataTable(opts) {
  injectStyle();
  const { id, columns, headRow, bar, chips: chipsEl = null, onChange, onRowClick, defaultSort = null, tieBreak = null, presets = [] } = opts;
  const emptyText = opts.emptyText || 'Tidak ada data.';
  const emptyFilteredText = opts.emptyFilteredText || 'Tidak ada data yang cocok dengan filter.';
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const sameSort = (a, b) => (!a && !b) || (!!a && !!b && a.key === b.key && a.dir === b.dir);

  let sort = defaultSort ? { ...defaultSort } : null;
  let filters = [];
  let prefs = resolveColumns(columns, readPrefs(id));
  let pop = null, popCleanup = null;
  let last = null; // { tbody, rows, ctx } terakhir yang digambar

  // Preset dari luar (mis. kartu dashboard). Dinormalisasi: tak tepercaya.
  const pre = consumeTablePreset(id);
  if (pre) {
    filters = pre.filters.map((f) => normalizeFilter(byKey.get(f && f.key), f)).filter(Boolean);
    const sc = pre.sort && byKey.get(pre.sort.key);
    if (sc && sc.sortable !== false) sort = { key: sc.key, dir: pre.sort.dir === 'desc' ? 'desc' : 'asc' };
  }

  const visible = () => prefs.order.filter((k) => !prefs.hidden.has(k)).map((k) => byKey.get(k));
  const state = () => ({ sort, filters });

  function closePop() {
    if (popCleanup) { popCleanup(); popCleanup = null; }
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
  }

  // ---------- header ----------
  function renderHead() {
    headRow.innerHTML = visible().map((c) => {
      const menuable = c.sortable !== false || c.filterable !== false;
      if (!menuable) return `<th>${esc(c.label)}</th>`;
      const sorted = !!sort && sort.key === c.key;
      const fil = filters.some((f) => f.key === c.key);
      const ikon = sorted ? (sort.dir === 'desc' ? 'ti-arrow-down' : 'ti-arrow-up') : 'ti-chevron-down';
      const aria = sorted ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none';
      return `<th class="th-has-menu" aria-sort="${aria}"><button type="button" class="th-btn${sorted || fil ? ' on' : ''}" data-dt-col="${esc(c.key)}" aria-haspopup="menu" title="Urutkan &amp; saring: ${esc(c.label)}"><span>${esc(c.label)}</span>${fil ? '<i class="ti ti-filter-filled th-fil" role="img" aria-label="Disaring"></i>' : ''}<i class="ti ${ikon} th-ind${sorted ? '' : ' th-ind-idle'}"></i></button></th>`;
    }).join('');
  }
  const onHeadClick = (e) => {
    const b = e.target.closest && e.target.closest('[data-dt-col]');
    if (b && headRow.contains(b)) openMenu(b.dataset.dtCol, b);
  };
  headRow.addEventListener('click', onHeadClick);

  // ---------- body ----------
  const cellHtml = (c, r, ctx) => {
    if (c.render) return c.render(r, ctx);
    const v = valOf(c, r);
    if (blank(v)) return NIL_HTML;
    return typeOf(c) === 'date' ? esc(fmtTgl(v)) : esc(v);
  };
  function renderBody(tbody, rows, ctx = {}) {
    last = { tbody, rows, ctx };
    const cols = visible();
    if (!rows.length) { showState(tbody, filters.length ? emptyFilteredText : emptyText, { reset: filters.length > 0 }); return; }
    tbody.classList.remove('is-loading');
    tbody.removeAttribute('aria-busy');
    tbody.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      if (onRowClick) {
        tr.className = 'clickable';
        tr.tabIndex = 0; // bisa dijangkau keyboard: Enter / Spasi = klik
        tr.addEventListener('click', () => onRowClick(r, ctx));
        tr.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); onRowClick(r, ctx); }
        });
      }
      tr.innerHTML = cols.map((c) => `<td${c.td ? ` class="${esc(c.td)}"` : ''}${c.tdStyle ? ` style="${esc(c.tdStyle)}"` : ''}>${cellHtml(c, r, ctx)}</td>`).join('');
      tbody.appendChild(tr);
    });
  }
  const boundBodies = new WeakSet();
  function bindBody(tbody) {
    if (boundBodies.has(tbody)) return;
    boundBodies.add(tbody);
    tbody.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-dt="reset-empty"]')) reset(); });
  }
  function showState(tbody, msg, { reset: withReset = false } = {}) {
    bindBody(tbody);
    tbody.classList.remove('is-loading');
    tbody.removeAttribute('aria-busy');
    tbody.innerHTML = `<tr class="state-row"><td colspan="${Math.max(1, visible().length)}">${esc(msg)}${withReset ? ' <button type="button" class="dt-link" data-dt="reset-empty">Hapus semua filter</button>' : ''}</td></tr>`;
  }
  /** Memuat ulang: baris yang ada diredupkan (layout tidak melompat); belum ada baris -> pesan memuat. */
  function setLoading(tbody) {
    bindBody(tbody);
    if (tbody.querySelector('tr:not(.state-row)')) { tbody.classList.add('is-loading'); tbody.setAttribute('aria-busy', 'true'); }
    else showState(tbody, 'Memuat data…');
  }

  // ---------- bar (Kolom + chip) ----------
  const sortDesc = () => {
    const c = sort && byKey.get(sort.key);
    if (!c) return '';
    const [lbA, lbD] = c.sortLabels || SORT_LABELS[typeOf(c)] || SORT_LABELS.text;
    return `${c.label}: ${(sort.dir === 'desc' ? lbD : lbA).replace(/^Urutkan /, '').toLowerCase()}`;
  };
  function renderBar() {
    if (!bar) return;
    const total = columns.length, shown = visible().length;
    const colBtn = `<button type="button" class="dt-colbtn" data-dt="cols" aria-haspopup="menu"><i class="ti ti-columns-3"></i> Kolom <span class="dt-count">${shown}/${total}</span></button>`;
    const chips = filters.map((f) => {
      const c = byKey.get(f.key);
      return c ? `<button type="button" class="dt-chip" data-dt-chip="${esc(f.key)}" title="Klik untuk hapus filter ini"><span>${esc(c.label)}:</span><b>${esc(describeFilter(c, f))}</b><i class="ti ti-x"></i></button>` : '';
    }).join('');
    const sortChip = sort && !sameSort(sort, defaultSort)
      ? `<button type="button" class="dt-chip" data-dt-chip="__sort__" title="Klik untuk kembali ke urutan bawaan"><span>Urut:</span><b>${esc(sortDesc())}</b><i class="ti ti-x"></i></button>` : '';
    const dirty = filters.length || (sort && !sameSort(sort, defaultSort));
    const extra = `${chips}${sortChip}${dirty ? '<button type="button" class="dt-reset" data-dt="reset"><i class="ti ti-filter-off"></i> Reset</button>' : ''}`;
    if (chipsEl) { bar.innerHTML = colBtn; chipsEl.innerHTML = extra; chipsEl.hidden = !extra; }
    else bar.innerHTML = colBtn + extra;
  }
  const onBarClick = (e) => {
    const chip = e.target.closest && e.target.closest('[data-dt-chip]');
    if (chip) { chip.dataset.dtChip === '__sort__' ? setSort(defaultSort) : removeFilter(chip.dataset.dtChip); return; }
    const b = e.target.closest && e.target.closest('[data-dt]');
    if (!b) return;
    if (b.dataset.dt === 'reset') reset();
    else if (b.dataset.dt === 'cols') openCols(b);
  };
  if (bar) bar.addEventListener('click', onBarClick);
  if (chipsEl) chipsEl.addEventListener('click', onBarClick);

  // ---------- perubahan state ----------
  function changed() {
    closePop();
    renderHead();
    renderBar();
    if (onChange) onChange(state());
  }
  function setFilter(key, f) {
    const nf = normalizeFilter(byKey.get(key), { ...f, key });
    if (!nf) return false;
    filters = upsertFilter(filters, nf);
    changed();
    return true;
  }
  function removeFilter(key) { filters = dropFilter(filters, key); changed(); }
  function setSort(s) {
    const c = s && byKey.get(s.key);
    sort = c && c.sortable !== false ? { key: s.key, dir: s.dir === 'desc' ? 'desc' : 'asc' } : null;
    changed();
  }
  function reset() { filters = []; sort = defaultSort ? { ...defaultSort } : null; changed(); }

  // ---------- popover ----------
  function placePop(anchor) {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(Math.round(r.bottom + 4), window.innerHeight - h - 8)) + 'px';
  }
  function showPop(html, anchor, key, className) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'th-menu-pop' + (className ? ' ' + className : '');
    pop.setAttribute('role', 'menu');
    pop.dataset.key = key;
    pop.innerHTML = html;
    document.body.appendChild(pop);
    placePop(anchor);
    const onDoc = (e) => { if (pop && !pop.contains(e.target) && !(e.target.closest && (e.target.closest('[data-dt-col]') || e.target.closest('[data-dt="cols"]')))) closePop(); };
    const onKey = (e) => { if (e.key === 'Escape') closePop(); };
    const onScroll = (e) => { if (pop && !(e.target && e.target.nodeType === 1 && pop.contains(e.target))) closePop(); }; // scroll DI DALAM menu (daftar opsi) jangan menutupnya
    const onResize = () => closePop();
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    popCleanup = () => {
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
    return pop;
  }

  function openMenu(key, anchor) {
    if (pop && pop.dataset.key === key) { closePop(); return; } // klik judul yang sama lagi = tutup
    const c = byKey.get(key);
    if (!c) return;
    const t = typeOf(c);
    const f = filters.find((x) => x.key === key);
    const parts = [`<div class="thm-title">${esc(c.label)}</div>`];
    const item = (act, icon, label, on, extra = '') => `<button type="button" class="thm-item${on ? ' on' : ''}" data-act="${act}" ${extra}><i class="ti ${icon}"></i><span>${esc(label)}</span>${on ? '<i class="ti ti-check thm-check"></i>' : ''}</button>`;

    if (c.sortable !== false) {
      const [lbA, lbD] = c.sortLabels || SORT_LABELS[t] || SORT_LABELS.text;
      const on = (d) => !!sort && sort.key === key && sort.dir === d;
      parts.push(item('sort', 'ti-sort-ascending', lbA, on('asc'), 'data-dir="asc"'), item('sort', 'ti-sort-descending', lbD, on('desc'), 'data-dir="desc"'));
    }
    if (c.filterable !== false) {
      if (c.sortable !== false) parts.push('<div class="thm-sep" role="separator"></div>');
      if (t === 'text') {
        parts.push(`<div class="dt-fin"><input type="text" class="dt-input" data-in="contains" placeholder="Mengandung…" value="${f && f.op === 'contains' ? esc(f.value) : ''}" autocomplete="off"><button type="button" class="dt-go" data-act="contains">Cari</button></div>`);
      } else if (t === 'enum') {
        const opts = optionList(c);
        const sel = new Set(f && f.op === 'in' ? f.value : []);
        parts.push(opts.length
          ? `<div class="dt-opts">${opts.map((o) => `<label class="dt-opt"><input type="checkbox" value="${esc(o.value)}"${sel.has(o.value) ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('')}</div><div class="dt-apply"><button type="button" class="dt-go" data-act="in">Terapkan</button></div>`
          : '<div class="dt-opts-empty">Belum ada pilihan.</div>');
      } else if (t === 'date') {
        (c.datePresets || []).forEach((p, i) => parts.push(item('preset', 'ti-calendar-event', p.label, !!f && f.op === p.filter.op && f.value === p.filter.value, `data-i="${i}"`)));
        const rg = f && f.op === 'antara' ? f.value : { from: f && f.op === 'dari' ? f.value : '', to: f && f.op === 'sampai' ? f.value : '' };
        parts.push(`<div class="dt-range"><span>Dari</span><input type="date" class="dt-input" data-in="from" value="${esc(rg.from)}"><span>Sampai</span><input type="date" class="dt-input" data-in="to" value="${esc(rg.to)}"><button type="button" class="dt-go" data-act="range">Terapkan rentang</button></div>`);
      } else if (t === 'bool') {
        parts.push(item('bool', 'ti-check', 'Ya', !!f && f.value === true, 'data-v="true"'), item('bool', 'ti-x', 'Tidak', !!f && f.value === false, 'data-v="false"'));
      }
      if (c.fillFilter !== false && t !== 'bool') {
        parts.push('<div class="thm-sep" role="separator"></div>', item('isi', 'ti-circle-check', 'Sudah diisi', !!f && f.op === 'isi'), item('kosong', 'ti-circle-dashed', 'Belum diisi', !!f && f.op === 'kosong'));
      }
      if (f) parts.push('<div class="thm-sep" role="separator"></div>', `<button type="button" class="thm-item thm-danger" data-act="hapus"><i class="ti ti-filter-off"></i><span>Hapus filter kolom ini</span></button>`);
    }
    const p = showPop(parts.join(''), anchor, key);

    const toggle = (op, value) => { if (f && f.op === op && JSON.stringify(f.value) === JSON.stringify(value)) removeFilter(key); else setFilter(key, { op, value }); };
    const applyText = () => { const v = p.querySelector('[data-in="contains"]').value.trim(); v ? setFilter(key, { op: 'contains', value: v }) : (f && f.op === 'contains' ? removeFilter(key) : closePop()); };
    const applyRange = () => {
      const from = p.querySelector('[data-in="from"]').value, to = p.querySelector('[data-in="to"]').value;
      if (from && to) setFilter(key, { op: 'antara', value: { from, to } });
      else if (from) setFilter(key, { op: 'dari', value: from });
      else if (to) setFilter(key, { op: 'sampai', value: to });
      else closePop();
    };
    p.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      switch (b.dataset.act) {
        case 'sort': setSort(nextSort(sort, key, b.dataset.dir)); break;
        case 'contains': applyText(); break;
        case 'in': { const v = [...p.querySelectorAll('.dt-opts input:checked')].map((i) => i.value); v.length ? setFilter(key, { op: 'in', value: v }) : (f ? removeFilter(key) : closePop()); break; }
        case 'preset': { const pr = c.datePresets[Number(b.dataset.i)]; if (pr) toggle(pr.filter.op, pr.filter.value); break; }
        case 'range': applyRange(); break;
        case 'bool': toggle('bool', b.dataset.v === 'true'); break;
        case 'isi': toggle('isi', undefined); break;
        case 'kosong': toggle('kosong', undefined); break;
        case 'hapus': removeFilter(key); break;
        default: break;
      }
    });
    p.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target.matches('input.dt-input')) return;
      e.preventDefault();
      e.target.dataset.in === 'contains' ? applyText() : applyRange();
    });
    const first = p.querySelector('input.dt-input');
    if (first) first.focus();
  }

  // ---------- pemilih kolom ----------
  function colsHtml() {
    const rows = prefs.order.map((k, i) => {
      const c = byKey.get(k);
      const lock = !!c.locked;
      return `<div class="dt-col${lock ? ' is-locked' : ''}" data-k="${esc(k)}"><label><input type="checkbox" data-tog="${esc(k)}"${prefs.hidden.has(k) ? '' : ' checked'}${lock ? ' disabled' : ''}><span>${esc(c.label)}</span></label>`
        + `<button type="button" class="dt-mv" data-mv="up" data-k="${esc(k)}" aria-label="Geser ke atas"${lock || i === 0 || byKey.get(prefs.order[i - 1]).locked ? ' disabled' : ''}><i class="ti ti-chevron-up"></i></button>`
        + `<button type="button" class="dt-mv" data-mv="down" data-k="${esc(k)}" aria-label="Geser ke bawah"${lock || i === prefs.order.length - 1 ? ' disabled' : ''}><i class="ti ti-chevron-down"></i></button></div>`;
    }).join('');
    const prs = presets.length ? `<div class="dt-prs">${presets.map((p) => `<button type="button" class="dt-pr" data-preset="${esc(p.id)}">${esc(p.label)}</button>`).join('')}<button type="button" class="dt-pr" data-preset="__default__">Bawaan</button></div>` : '';
    return `<div class="thm-title">Kolom yang tampil</div>${prs}<div class="dt-opts">${rows}</div>`;
  }
  function colsChanged() {
    writePrefs(id, prefs);
    renderHead();
    renderBar();
    if (last) renderBody(last.tbody, last.rows, last.ctx);
    if (opts.onColumnsChange) opts.onColumnsChange(visible().map((c) => c.key));
  }
  function openCols(anchor) {
    if (pop && pop.dataset.key === '__cols__') { closePop(); return; }
    const p = showPop(colsHtml(), anchor, '__cols__', 'dt-cols');
    const redraw = () => { const sc = p.querySelector('.dt-opts').scrollTop; p.innerHTML = colsHtml(); p.querySelector('.dt-opts').scrollTop = sc; placePop(anchor); };
    p.addEventListener('change', (e) => {
      const k = e.target.dataset && e.target.dataset.tog;
      if (!k) return;
      if (e.target.checked) prefs.hidden.delete(k); else if (visible().length > 1) prefs.hidden.add(k); else e.target.checked = true; // minimal satu kolom tersisa
      colsChanged(); redraw();
    });
    p.addEventListener('click', (e) => {
      const mv = e.target.closest && e.target.closest('[data-mv]');
      if (mv) {
        const i = prefs.order.indexOf(mv.dataset.k), j = mv.dataset.mv === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= prefs.order.length || byKey.get(prefs.order[j]).locked) return;
        [prefs.order[i], prefs.order[j]] = [prefs.order[j], prefs.order[i]];
        colsChanged(); redraw();
        return;
      }
      const pr = e.target.closest && e.target.closest('[data-preset]');
      if (pr) {
        if (pr.dataset.preset === '__default__') prefs = resolveColumns(columns, null);
        else {
          const def = presets.find((x) => x.id === pr.dataset.preset);
          if (!def) return;
          const keys = def.keys.filter((k) => byKey.has(k));
          const rest = prefs.order.filter((k) => !keys.includes(k));
          const locked = columns.filter((c) => c.locked).map((c) => c.key);
          const order = [...locked, ...keys.filter((k) => !locked.includes(k)), ...rest.filter((k) => !locked.includes(k))];
          prefs = { order, hidden: new Set(rest.filter((k) => !locked.includes(k))) };
        }
        colsChanged(); redraw();
      }
    });
  }

  renderHead();
  renderBar();

  return {
    applyQuery: (q) => applyToQuery(q, state(), columns, { tieBreak }),
    needsInner: () => needsInner(state(), columns),
    sortUsesJoin: () => sortUsesJoin(state(), columns),
    getState: state,
    hasFilters: () => filters.length > 0,
    setFilter, removeFilter, setSort, reset,
    renderHead, renderBar, renderBody, showState, setLoading,
    visibleKeys: () => visible().map((c) => c.key),
    destroy() { closePop(); headRow.removeEventListener('click', onHeadClick); if (bar) bar.removeEventListener('click', onBarClick); if (chipsEl) chipsEl.removeEventListener('click', onBarClick); },
  };
}
