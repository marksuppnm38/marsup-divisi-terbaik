// shared/api.js
// ══════════════════════════════════════════
// SATU pintu untuk panggilan RPC Supabase (REST) dari modul-modul yang
// sebelumnya punya implementasi sendiri-sendiri:
//   - populasi/index.js      (punya timeout, tapi salinan sendiri)
//   - konversian/clipboard.js (S.rpc -> sesiFetch: TANPA timeout, dan
//                              res.json() melempar SyntaxError kalau server
//                              balas non-JSON, mis. 502 HTML dari proxy)
//
// ES module biasa: di-import langsung (`import { apiRpc } from '../../../shared/api.js'`),
// jadi otomatis ikut ter-bundle oleh scripts/build.mjs -- TIDAK perlu
// didaftarkan di CLASSIC_SHARED_SCRIPTS (itu cuma untuk file yang dimuat
// lewat <script src>).
//
// Perilaku:
//   - Timeout (default 30 dtk, 60 dtk untuk RPC bulk/tulis) -> throw Error code 'TIMEOUT'.
//   - Pembatalan dari pemanggil (opts.signal) -> throw AbortError APA ADANYA
//     (pemanggil yang minta batal, jadi bukan error yang perlu ditampilkan).
//   - Retry 1x HANYA untuk RPC baca (search_/get_/suggest_/cari_/detail_/resolve_)
//     dan HANYA untuk error jaringan atau HTTP 502/503/504, dengan backoff.
//     Timeout TIDAK di-retry (server sedang lambat; mengulang cuma menggandakan beban).
//     RPC tulis tidak pernah di-retry otomatis (bisa dobel-tulis).
//   - Body error non-JSON (502 HTML dst) tidak lagi melempar SyntaxError: jadi
//     { message: '...' } biasa.
//   - 401 / token kosong -> panggil opts.onUnauthorized() lalu throw.
// ══════════════════════════════════════════

const READ_RPC_RE = /^(search_|get_|suggest_|cari_|detail_|resolve_)/;
const SLOW_RPC_RE = /(bulk|record_|add_permintaan|save_|upsert|sync|import)/;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

export const DEFAULT_TIMEOUT_MS = 30000;
export const SLOW_TIMEOUT_MS = 60000;

export function isReadRpc(fn) {
  return READ_RPC_RE.test(String(fn || ''));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseBody(text, status) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // Bukan JSON (halaman error proxy/CDN). Jangan bocorkan HTML mentah ke UI.
    return { message: `HTTP ${status}${text.length < 160 && !/[<>]/.test(text) ? ': ' + text : ''}` };
  }
}

// Mengembalikan { ok, status, body }. THROW untuk: jaringan putus, timeout,
// dibatalkan pemanggil, 401/token kosong. Status HTTP lain (400/404/409/5xx)
// TIDAK throw: pemanggil yang memutuskan (supaya kompatibel dengan kode lama
// yang memeriksa `error` dari hasil RPC).
//
// opts: { url, key, token (string | () => string|Promise<string>), timeout,
//         retries, signal, onUnauthorized, unauthorizedMessage }
export async function apiRpc(fn, params, opts = {}) {
  const url = opts.url || window.PNM_SUPABASE_URL;
  const key = opts.key || window.PNM_SUPABASE_ANON_KEY;
  const timeout = opts.timeout || (SLOW_RPC_RE.test(fn) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const retries = opts.retries != null ? opts.retries : (isReadRpc(fn) ? 1 : 0);
  const unauthorized = (msg) => {
    try { if (opts.onUnauthorized) opts.onUnauthorized(); } catch (e) { /* handler gagal tidak boleh menutupi error asli */ }
    const err = new Error(opts.unauthorizedMessage || msg || 'unauthorized');
    err.status = 401;
    return err;
  };
  const body = JSON.stringify(params || {});

  for (let attempt = 0; ; attempt++) {
    if (opts.signal && opts.signal.aborted) {
      throw new DOMException('Dibatalkan', 'AbortError');
    }
    const token = typeof opts.token === 'function' ? await opts.token() : opts.token;
    if (!token) throw unauthorized('unauthorized: no access token');

    const ctrl = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => ctrl.abort();
    if (opts.signal) opts.signal.addEventListener('abort', onCallerAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeout);

    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + token },
        body,
        signal: ctrl.signal,
      });
      if (res.status === 401) throw unauthorized();
      const text = await res.text();
      const parsed = parseBody(text, res.status);
      if (!res.ok && RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        await sleep(300 * 2 ** attempt + Math.random() * 150);
        continue;
      }
      return { ok: res.ok, status: res.status, body: parsed };
    } catch (err) {
      if (err && err.status === 401) throw err;
      if (opts.signal && opts.signal.aborted) throw new DOMException('Dibatalkan', 'AbortError');
      if (timedOut) {
        const e = new Error(`RPC ${fn} timeout (>${Math.round(timeout / 1000)}s)`);
        e.code = 'TIMEOUT';
        throw e;
      }
      // Jaringan putus / DNS / CORS preflight gagal -> TypeError dari fetch. Coba sekali lagi untuk RPC baca.
      if (attempt < retries && err instanceof TypeError) {
        await sleep(300 * 2 ** attempt + Math.random() * 150);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

// ── Sanitasi input search untuk filter PostgREST .or(...) ──
// Masalah lama: `.or(\`kode.ilike.%${q}%,nama.ilike.%${q}%\`)` memasukkan ketikan
// user mentah ke sintaks filter. Koma / kurung / tanda kutip di ketikan
// (mis. "forceps, 14 cm (lurus)") memutus atau mengubah arti filter.
// Karakter yang punya arti di sintaks itu diganti spasi; tanda `.`/`:`/`-` aman.
export function likeTerm(q) {
  return String(q == null ? '' : q).replace(/[,()"\\%*]/g, ' ').replace(/\s+/g, ' ').trim();
}

// orIlike(['kode_produk','nama_produk'], q) -> 'kode_produk.ilike.%q%,nama_produk.ilike.%q%'
// Dipakai sebagai argumen .or(). Kalau ketikan habis disanitasi (cuma tanda baca),
// jadi pola '%' (cocok semua) -- aman karena pemanggil selalu pakai .limit().
export function orIlike(columns, q) {
  const t = likeTerm(q);
  return columns.map((c) => `${c}.ilike.%${t}%`).join(',');
}