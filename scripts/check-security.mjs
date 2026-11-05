// scripts/check-security.mjs
// Pemeriksaan keamanan ringan (tanpa dependensi, jalan di lokal maupun CI): `npm run check:security`
// Exit code 1 kalau ada ERROR; WARNING hanya dicetak. Tidak mengubah file apa pun.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.py', '.txt']);
const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(path.extname(e.name)) && e.name !== 'package-lock.json') out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p);
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

const files = walk(ROOT);
const APP_FILES = files.filter((f) => /^(app|shared)[\\/]/.test(rel(f)) && f.endsWith('.js'));

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');

  // 1) JWT Supabase: hanya role "anon" yang boleh ada di repo. service_role = bocor total.
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString('utf8'));
      if (payload.role && payload.role !== 'anon') {
        errors.push(`${rel(f)}:${lineOf(text, m.index)} JWT dengan role "${payload.role}" ada di repo (hanya "anon" yang boleh).`);
      }
    } catch { /* bukan JWT valid, abaikan */ }
  }

  // 2) Pola kunci rahasia lain
  for (const [re, label] of [
    [/sb_secret_[A-Za-z0-9_-]{10,}/g, 'Supabase secret key'],
    [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, 'private key'],
    [/service_role['"]?\s*[:=]\s*['"]eyJ/g, 'service_role key'],
  ]) {
    for (const m of text.matchAll(re)) errors.push(`${rel(f)}:${lineOf(text, m.index)} ${label} ditemukan.`);
  }
}

// 3) Pemeriksaan khusus kode aplikasi
for (const f of APP_FILES) {
  const text = fs.readFileSync(f, 'utf8');
  const checks = [
    [/\|\|\s*(?:SUPABASE_)?ANON_KEY\b/g, 'fallback ke ANON_KEY (sesi habis jadi request anon diam-diam)'],
    [/\beval\s*\(|new\s+Function\s*\(/g, 'eval/new Function'],
    [/console\.(?:log|debug|info)\([^)]*(?:access_token|refresh_token|password)/gi, 'token/password dicetak ke console'],
  ];
  for (const [re, label] of checks) {
    for (const m of text.matchAll(re)) {
      const line = text.split('\n')[lineOf(text, m.index) - 1];
      if (/^\s*(\/\/|\*)/.test(line)) continue; // komentar
      warnings.push(`${rel(f)}:${lineOf(text, m.index)} ${label}`);
    }
  }
}

// 4) Header keamanan wajib di vercel.json
try {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const keys = new Set((v.headers || []).flatMap((h) => (h.headers || []).map((x) => x.key.toLowerCase())));
  for (const k of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options']) {
    if (!keys.has(k)) errors.push(`vercel.json: header ${k} tidak ada.`);
  }
  if (!keys.has('content-security-policy-report-only')) warnings.push('vercel.json: tidak ada CSP Report-Only.');
} catch (e) {
  errors.push('vercel.json tidak bisa dibaca: ' + e.message);
}

// 5) Aset sensitif yang disajikan publik
const assetsDir = path.join(ROOT, 'assets');
if (fs.existsSync(assetsDir)) {
  for (const n of fs.readdirSync(assetsDir)) {
    if (/ttd|tanda[-_ ]?tangan|signature/i.test(n)) warnings.push(`assets/${n}: tanda tangan di folder publik (bisa diunduh tanpa login).`);
  }
}

for (const w of warnings) console.warn('WARN  ' + w);
for (const e of errors) console.error('ERROR ' + e);
console.log(`\ncheck:security selesai: ${errors.length} error, ${warnings.length} warning.`);
process.exit(errors.length ? 1 : 0);
