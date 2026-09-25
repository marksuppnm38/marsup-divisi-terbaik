// AUTO-EXTRACTED dari konversian/index.js (breakup sesuai map.md bagian 3) — Claude, 2026-09-15.
// Region asli: lihat map.md bagian 2. Semua state lintas-file diakses lewat
// objek 'S' yang dioper dari index.js (S = window.__konvBridge-style shared
// state, TAPI bukan window global — cuma dioper sebagai parameter, lihat
// index.js: const S = {}; lalu install*(S) dipanggil berurutan).
// Logic di dalam TIDAK diubah — cuma referensi ke variabel/fungsi yang
// didefinisikan di file LAIN diganti jadi S.nama (lihat COORD LOG index.js).
export function installRealtime(S) {
// ══════════════════════════════════════════════════════════════════════════
// REALTIME KOLABORASI — satu sesi = satu live workspace. Dua channel per sesi:
//   1) sesi-db-*       → postgres_changes (sumber kebenaran: tabel SESI_TABLE &
//      SESI_ITEM_TABLE). Ini yang bikin clipboard/header orang lain nongol
//      otomatis — lewat patchClipItem/insertClipItem/removeClipItemDom yang
//      cuma nyentuh baris yang berubah, BUKAN updateClipboard() penuh.
//   2) sesi-presence-* → presence + broadcast, buat hal yang EPHEMERAL doang
//      (siapa online, siapa lagi ngedit apa). Sengaja gak numpang ke tabel
//      manapun — otomatis bersih begitu tab ditutup, gak ninggalin baris
//      "lock" yang nyangkut kalau browser crash.
// Siklusnya ngikutin currentSesiId: subscribeToSesiRealtime() dipanggil begitu
// currentSesiId final (ensureSesi()/openSesi()), unsubscribe dipanggil dari
// resetChecklistUI() di atas — titik reset terpusat yang sama dipakai
// resetSsReferences().
// ══════════════════════════════════════════════════════════════════════════
let sesiDbChannel = null;
// Nama yang ditampilin buat presence/activity/editing-indicator — pake PIC Marsup
// (lebih manusiawi daripada email), fallback ke email kalau belum diisi.
function currentDisplayName() {
  return (S.inpMarsup && S.inpMarsup.value.trim()) || (S.currentUser && S.currentUser.email) || 'Anonim';
}
S.currentDisplayName = currentDisplayName;
S.sesiPresenceChannel = null;
let presenceRoster = {}; // presence key -> {nama, status, joined_at}
let rtActivityLog = []; // {ts, msg} — dicap N item terakhir, lihat pushActivity()

// Jejak tulisan lokal barusan, biar event postgres_changes yang notabene
// "gema" dari tulisan sendiri gak di-reapply (nge-pulse/nge-flash sendiri).
const recentLocalWrites = new Map(); // key: `${table}:${id}:${field}` -> {value, ts}
const RECENT_WRITE_TTL_MS = 2500;
function markLocalWrite(table, id, field, value) {
  if (!id) return;
  recentLocalWrites.set(`${table}:${id}:${field}`, { value, ts: Date.now() });
}
S.markLocalWrite = markLocalWrite;
function isEchoOfLocalWrite(table, id, field, value) {
  const key = `${table}:${id}:${field}`;
  const rec = recentLocalWrites.get(key);
  if (!rec) return false;
  if (Date.now() - rec.ts > RECENT_WRITE_TTL_MS) { recentLocalWrites.delete(key); return false; }
  // Nilainya sama persis → emang gema tulisan sendiri. Kalau beda, tetap
  // dianggap perubahan asli (ke-outrace tulisan orang lain di window yang sama).
  return String(rec.value) === String(value);
}

let rtConnState = 'offline'; // dipake buat nyusun title tooltip gabungan sama presence
function updateRtStatus(state) {
  // state: 'connecting' | 'live' | 'reconnecting' | 'offline'
  rtConnState = state;
  const dot = document.getElementById('rt-status-dot');
  const wrap = document.getElementById('rt-live');
  if (!dot || !wrap) return;
  wrap.style.display = S.currentSesiId ? 'flex' : 'none';
  dot.classList.remove('dot-live', 'dot-connecting', 'dot-reconnecting', 'dot-offline');
  dot.classList.add('dot-' + state);
  renderPresenceRoster(); // ikut update tooltip-nya (teks koneksi + daftar nama gabung di situ)
}

function subscribeToSesiRealtime(sesiId) {
  if (!S.rt || !sesiId) return; // SDK gagal dimuat / gak ada sesi → diam-diam gak aktifin live sync, app tetap jalan manual kayak sebelumnya
  unsubscribeFromSesiRealtime(); // jaga-jaga: jangan sampai numpuk channel dari sesi sebelumnya
  S.syncRealtimeAuth(); // pastiin token authenticated kepasang tiap kali (re)subscribe, jangan andelin sekali panggil pas login doang
  updateRtStatus('connecting');

  // Item Kebutuhan RS (tabel permintaan_item) SENGAJA gak disubscribe lewat
  // postgres_changes di sini — kena berlapis masalah di setup ini (auth Realtime
  // kepeleset ke anon, kolom filter gak ke-index) dan biarpun udah dibenerin
  // semua tetep gak reliable. Update status item disiarin lewat Broadcast aja
  // (lihat broadcastChecklistItemUpdated/handleChecklistItemUpdatedBroadcast di
  // channel presence bawah), sama pola yang dipakai clipboard.
  const dbChannel = S.rt.channel(`sesi-db-${sesiId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: S.SESI_TABLE, filter: `id=eq.${sesiId}` }, handleSesiRowChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: S.SESI_ITEM_TABLE, filter: `sesi_id=eq.${sesiId}` }, handleItemRowChange);
  sesiDbChannel = dbChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') updateRtStatus('live');
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') updateRtStatus('reconnecting');
    else if (status === 'CLOSED') updateRtStatus('offline');
  });

  const presenceKey = S.currentUser ? S.currentUser.id : ('anon-' + Math.random().toString(36).slice(2, 9));
  S.sesiPresenceChannel = S.rt.channel(`sesi-presence-${sesiId}`, { config: { presence: { key: presenceKey } } })
    .on('presence', { event: 'sync' }, handlePresenceSync)
    .on('presence', { event: 'join' }, handlePresenceJoin)
    .on('presence', { event: 'leave' }, handlePresenceLeave)
    .on('broadcast', { event: 'item_removed' }, handleItemRemovedBroadcast)
    .on('broadcast', { event: 'checklist_item_updated' }, handleChecklistItemUpdatedBroadcast)
    .on('broadcast', { event: 'checklist_reload' }, handleChecklistReloadBroadcast)
    .on('broadcast', { event: 'editing' }, S.handleEditingBroadcast)
    .on('broadcast', { event: 'editing_stop' }, S.handleEditingStopBroadcast)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await S.sesiPresenceChannel.track({
            nama: currentDisplayName(),
            status: 'online',
            joined_at: new Date().toISOString()
          });
        } catch { /* presence gagal gak boleh nge-block kerjaan utama */ }
      }
    });

  // Away kalau tab disembunyikan >30 detik — kembali online begitu dibuka lagi.
  document.addEventListener('visibilitychange', handleVisibilityForPresence);
}
S.subscribeToSesiRealtime = subscribeToSesiRealtime;

let awayTimer = null;
function handleVisibilityForPresence() {
  if (!S.sesiPresenceChannel) return;
  clearTimeout(awayTimer);
  if (document.hidden) {
    awayTimer = setTimeout(() => {
      S.sesiPresenceChannel && S.sesiPresenceChannel.track({ nama: currentDisplayName(), status: 'away', joined_at: new Date().toISOString() }).catch(() => {});
    }, 30000);
  } else {
    S.sesiPresenceChannel.track({ nama: currentDisplayName(), status: 'online', joined_at: new Date().toISOString() }).catch(() => {});
    // Tab baru balik kelihatan — jangan andelin TOKEN_REFRESHED (bisa telat/
    // ke-throttle browser pas tab tadi di-background), paksa re-sync token
    // realtime di sini juga biar postgres_changes gak kena filter diam-diam
    // gara-gara token basi (lihat komentar di syncRealtimeAuth()).
    S.syncRealtimeAuth();
  }
}

function unsubscribeFromSesiRealtime() {
  document.removeEventListener('visibilitychange', handleVisibilityForPresence);
  clearTimeout(awayTimer);
  if (S.rt && sesiDbChannel) S.rt.removeChannel(sesiDbChannel);
  if (S.rt && S.sesiPresenceChannel) S.rt.removeChannel(S.sesiPresenceChannel);
  sesiDbChannel = null;
  S.sesiPresenceChannel = null;
  presenceRoster = {};
  rtActivityLog = [];
  renderPresenceRoster();
  renderActivityFeed();
  updateRtStatus('offline');
  const wrap = document.getElementById('rt-live');
  if (wrap) wrap.style.display = 'none';
  // Badge "sedang mengedit" nempel ke sesi yang lama — bersihin biar gak nyisa
  // pas pindah/buka sesi lain.
  clearInterval(S.editingBroadcastTimer);
  Object.keys(S.editingBadgeTimers).forEach(field => {
    clearTimeout(S.editingBadgeTimers[field]);
    const badge = document.getElementById('editing-badge-' + field);
    if (badge) badge.classList.remove('show');
  });
}
S.unsubscribeFromSesiRealtime = unsubscribeFromSesiRealtime;

// ---- Handler: baris sesi_konversi berubah (header/pagu/status/butuh_bantuan) ----
function handleSesiRowChange(payload) {
  if (payload.eventType === 'DELETE') return; // dihapus ditangani lewat alur hapus sesi yang sudah ada
  const row = payload.new;
  if (!row || row.id !== S.currentSesiId) return;

  // Nama RS/Sales/PIC: jangan timpa field yang LAGI DIFOKUS user lokal (lagi diketik).
  [['nama_rs', S.inpRs], ['nama_sales', S.inpSales], ['pic_marsup', S.inpMarsup]].forEach(([field, el]) => {
    if (!el) return;
    if (isEchoOfLocalWrite(S.SESI_TABLE, row.id, field, row[field])) return;
    if (document.activeElement === el) return;
    const newVal = row[field] || '';
    if (el.value !== newVal) {
      el.value = newVal;
      el.classList.add('rt-field-pulse');
      setTimeout(() => el.classList.remove('rt-field-pulse'), 1100);
    }
  });

  if (row.pagu !== S.checklistPagu && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, 'pagu', row.pagu)) {
    S.checklistPagu = row.pagu;
    S.updateClipAggregates(); // cuma hitung ulang total/budget, gak nyentuh daftar item
    pushActivity('Pagu diperbarui');
  }
  if (!!row.butuh_bantuan !== S.currentButuhBantuan && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, 'butuh_bantuan', row.butuh_bantuan)) {
    S.currentButuhBantuan = !!row.butuh_bantuan;
    if (typeof S.renderButuhBantuanBtn === 'function') S.renderButuhBantuanBtn();
    pushActivity(S.currentButuhBantuan ? 'Minta bantuan diaktifkan' : 'Minta bantuan dibatalkan');
  }
  // Mode harga (E-Katalog/Swasta) ditetapkan pembuat sesi — kolaborator lain harus
  // ikut, bukan mulai dari default lokal masing-masing (lihat COORD LOG di atas).
  if (!!row.mode_harga_swasta !== S.modeSwastaOutput && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, 'mode_harga_swasta', row.mode_harga_swasta)) {
    S.setModeSwastaOutput(!!row.mode_harga_swasta);
    pushActivity(row.mode_harga_swasta ? 'Mode harga diubah ke Swasta oleh kolaborator' : 'Mode harga diubah ke E-Katalog oleh kolaborator');
  }
}

// ---- Handler: baris sesi_konversi_item berubah (isi clipboard) ----
function handleItemRowChange(payload) {
  if (!S.currentSesiId) return;

  // PENTING soal DELETE: Supabase Postgres Changes SECARA RESMI gak nge-filter
  // event DELETE di server sama sekali (beda dari INSERT/UPDATE) — lihat
  // https://supabase.com/docs/guides/realtime/postgres-changes#delete-events-are-not-filterable
  // Ditambah lagi payload.old default-nya cuma isi primary key (`id`), gak ada
  // sesi_id, jadi filter `row.sesi_id !== currentSesiId` GAK BISA dipakai buat
  // DELETE — bakal selalu gagal match dan diem-diem nge-drop semua delete.
  // Solusinya: DELETE difilter dari sisi client pakai keanggotaan di clipboard
  // LOKAL kita (yang emang udah pasti isinya cuma item sesi ini), bukan dari
  // kolom sesi_id di payload.
  if (payload.eventType === 'DELETE') {
    const row = payload.old;
    if (!row || row.id == null) return;
    const item = S.clipboard.find(c => c._sesiItemId === row.id);
    if (!item) return; // bukan item sesi ini, atau emang udah kehapus lokal duluan (optimistic)
    const nama = item.nama_produk;
    S.removeClipItemDom(item.kode_produk);
    pushActivity(`${nama} dihapus`);
    return;
  }

  // INSERT & UPDATE difilter server-side dengan benar (payload.new selalu lengkap),
  // baris di bawah cuma jaga-jaga kalau ada race/event nyasar.
  const row = payload.new;
  if (!row || row.sesi_id !== S.currentSesiId) return;

  if (payload.eventType === 'INSERT') {
    // kode_produk unik per clipboard (dipakai jadi key di mana-mana) — cukup buat
    // ngecek "ini beneran baru" tanpa perlu tracking id kayak update/delete.
    if (S.clipboard.some(c => c.kode_produk === row.kode_produk)) return;
    S.insertClipItem(S.mapSesiItemRowToClipItem(row));
    pushActivity(`${presenceNameGuess()} menambahkan ${row.nama_produk}`);
    return;
  }
  if (payload.eventType === 'UPDATE') {
    const item = S.clipboard.find(c => c._sesiItemId === row.id);
    if (!item) { S.insertClipItem(S.mapSesiItemRowToClipItem(row)); return; }
    if (row.qty !== item.qty && !isEchoOfLocalWrite(S.SESI_ITEM_TABLE, row.id, 'qty', row.qty)) {
      const oldQty = item.qty;
      S.patchClipItem(item.kode_produk, { qty: row.qty });
      pushActivity(`Qty ${item.nama_produk} ${oldQty} → ${row.qty}`);
    }
  }
}

// Placeholder ringan buat "siapa yang ngelakuin ini" di activity feed — presence
// gak nyimpen histori per-event, jadi paling akurat yang bisa kita bilang cuma
// "kolaborator" kalau bukan diri sendiri. Upgrade ke nama presisi (butuh kolom
// pengubah di tabel item) masuk tahap activity-feed berikutnya.
function presenceNameGuess() {
  return 'Kolaborator';
}

// ---- Penghapusan item: Broadcast manual, bukan andelin postgres_changes DELETE ----
// LATAR BELAKANG: postgres_changes event DELETE terbukti gak reliable di Supabase
// Realtime buat setup ini — udah dicek satu-satu (publication, RLS, replica identity,
// bahkan SQL DELETE langsung dari SQL Editor) dan semuanya benar, tapi event-nya tetep
// gak pernah nyampe. Ini match sama bug yang udah lama dilaporin di beberapa repo
// Supabase (INSERT/UPDATE jalan, DELETE diem) — bukan salah konfigurasi kita. Makanya
// penghapusan disiarin manual lewat Broadcast (send/on, bukan postgres_changes), yang
// justru direkomendasikan Supabase sendiri buat use-case yang butuh reliability.
function broadcastItemRemoved(item) {
  if (!S.sesiPresenceChannel) return;
  S.sesiPresenceChannel.send({
    type: 'broadcast',
    event: 'item_removed',
    payload: { kode_produk: item.kode_produk, sesi_item_id: item._sesiItemId, nama_produk: item.nama_produk, actor: currentDisplayName() }
  }).catch(() => { /* broadcast gagal gak boleh nge-block penghapusan lokal — item ini tetap kehapus di sisi yang ngirim */ });
}
S.broadcastItemRemoved = broadcastItemRemoved;
function handleItemRemovedBroadcast({ payload }) {
  if (!payload || !payload.kode_produk) return;
  const item = S.clipboard.find(c => c.kode_produk === payload.kode_produk);
  if (!item) return; // udah kehapus duluan lokal, atau bukan item sesi ini
  S.removeClipItemDom(item.kode_produk);
  pushActivity(`${payload.actor ? payload.actor + ' menghapus ' : ''}${payload.nama_produk || item.nama_produk}${payload.actor ? '' : ' dihapus'}`);
}

// ---- Update status item Kebutuhan RS: Broadcast manual, sama kayak pola DELETE
// clipboard di atas ----
// LATAR BELAKANG: postgres_changes buat tabel permintaan_item kena berlapis-lapis
// masalah di setup ini (auth Realtime kepeleset ke anon, kolom filter permintaan_id
// gak ke-index, dst) — daripada terus gantung ke situ, status item disiarin manual
// lewat Broadcast begitu update ke server sukses, persis pola yang udah kebukti
// reliable buat clipboard.
function broadcastChecklistItemUpdated(item) {
  if (!S.sesiPresenceChannel) return;
  S.sesiPresenceChannel.send({
    type: 'broadcast',
    event: 'checklist_item_updated',
    payload: { id: item.id, status: item.status, matched_items: item.matched_items || [], raw_text: item.raw_text, actor: currentDisplayName() }
  }).catch(() => { /* broadcast gagal gak boleh nge-block update lokal — item ini tetap keupdate di sisi yang ngirim */ });
}
S.broadcastChecklistItemUpdated = broadcastChecklistItemUpdated;
// Daftar item Permintaan RS berubah (tambah item / koreksi nama-qty): kolaborator muat ulang
// dari server. Sengaja "muat ulang", bukan kirim datanya lewat broadcast — sumber kebenaran tetap DB.
function broadcastChecklistReload() {
  if (!S.sesiPresenceChannel) return;
  S.sesiPresenceChannel.send({
    type: 'broadcast',
    event: 'checklist_reload',
    payload: { actor: currentDisplayName() }
  }).catch(() => { /* gagal broadcast gak boleh nge-block; kolaborator masih bisa klik refresh manual */ });
}
S.broadcastChecklistReload = broadcastChecklistReload;
function handleChecklistReloadBroadcast({ payload }) {
  if (!S.currentSesiId) return;
  S.loadChecklistForSesi(S.currentSesiId, { quiet: true });
  pushActivity(`${payload && payload.actor ? payload.actor + ' mengubah' : 'Ada perubahan pada'} daftar Permintaan RS`);
}
function handleChecklistItemUpdatedBroadcast({ payload }) {
  if (!payload || payload.id == null) return;
  const item = S.checklistItems.find(i => i.id === payload.id);
  if (!item) return;
  const statusChanged = payload.status !== item.status;
  S.patchChecklistItem(payload.id, { status: payload.status, matched_items: payload.matched_items || [] });
  // badge "RS n" di clipboard ikut segar — tapi jangan rebuild kalau user lagi ngetik di baris clipboard
  if (!S.clipList.contains(document.activeElement)) S.updateClipboard();
  if (statusChanged) {
    const label = payload.status === 'TERPENUHI' ? 'bisa dipenuhi' : payload.status === 'TIDAK_TERPENUHI' ? 'tidak bisa dipenuhi' : 'PENDING lagi';
    const actor = payload.actor ? payload.actor + ' menandai ' : '';
    pushActivity(`${actor}"${payload.raw_text || item.raw_text}" ${label}`);
  }
}

// ---- Activity feed ringan (in-memory, dicap 8 entri terakhir) ----
function pushActivity(msg) {
  rtActivityLog.unshift({ ts: new Date(), msg });
  if (rtActivityLog.length > 8) rtActivityLog.length = 8;
  renderActivityFeed();
}
function renderActivityFeed() {
  const wrap = document.getElementById('rt-feed-wrap');
  const el = document.getElementById('rt-activity-feed');
  const label = document.getElementById('rt-feed-toggle-label');
  if (!wrap || !el) return;
  if (!rtActivityLog.length) { wrap.style.display = 'none'; el.innerHTML = ''; return; }
  wrap.style.display = 'block';
  if (label) label.textContent = `Aktivitas terbaru (${rtActivityLog.length})`;
  el.innerHTML = rtActivityLog.map((a, i) => {
    const hh = String(a.ts.getHours()).padStart(2, '0');
    const mm = String(a.ts.getMinutes()).padStart(2, '0');
    return `<div${i === 0 ? ' class="rt-fade-in"' : ''} style="padding:2px 0">${hh}:${mm} — ${a.msg}</div>`;
  }).join('');
}
document.getElementById('rt-feed-toggle').addEventListener('click', () => {
  document.getElementById('rt-feed-wrap').classList.toggle('rt-feed-collapsed');
});

// ---- Presence ----
function handlePresenceSync() {
  if (!S.sesiPresenceChannel) return;
  const state = S.sesiPresenceChannel.presenceState();
  const roster = {};
  Object.keys(state).forEach(key => {
    const entries = state[key];
    if (entries && entries.length) roster[key] = entries[entries.length - 1];
  });
  presenceRoster = roster;
  renderPresenceRoster();
}
function handlePresenceJoin({ key, newPresences }) {
  if (S.currentUser && key === S.currentUser.id) return; // diri sendiri, gak usah notif
  const nama = newPresences && newPresences[0] && newPresences[0].nama;
  if (nama) S.showToast(`${nama} bergabung ke sesi ini`, 'presence');
}
function handlePresenceLeave({ key, leftPresences }) {
  if (S.currentUser && key === S.currentUser.id) return;
  const nama = leftPresences && leftPresences[0] && leftPresences[0].nama;
  if (nama) S.showToast(`${nama} keluar dari sesi`, 'presence');
}
const RT_AVATAR_PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#46a758', '#12a594', '#0091ff', '#8e4ec6', '#e93d82'];
function avatarColorFor(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return RT_AVATAR_PALETTE[hash % RT_AVATAR_PALETTE.length];
}
function initialsFor(nama) {
  const parts = nama.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const RT_STATUS_LABELS = { connecting: 'Menyambungkan…', live: 'Live', reconnecting: 'Menyambung ulang…', offline: 'Offline' };
function renderPresenceRoster() {
  const wrap = document.getElementById('rt-live');
  const cluster = document.getElementById('rt-avatar-cluster');
  if (!wrap || !cluster) return;
  const entries = Object.values(presenceRoster).filter(p => p.nama);
  const MAX_SHOWN = 4;
  const shown = entries.slice(0, MAX_SHOWN);
  const overflow = entries.length - shown.length;
  cluster.innerHTML = shown.map(p => {
    const awayCls = p.status === 'away' ? ' away' : '';
    return `<span class="rt-avatar${awayCls}" style="background:${avatarColorFor(p.nama)}">${initialsFor(p.nama)}</span>`;
  }).join('') + (overflow > 0 ? `<span class="rt-avatar-more">+${overflow}</span>` : '');
  const names = entries.map(p => p.nama + (p.status === 'away' ? ' (away)' : ''));
  wrap.title = (names.length ? names.join(', ') : 'Cuma kamu di sesi ini') + ' — ' + (RT_STATUS_LABELS[rtConnState] || '');
}

// Ambil Permintaan RS yang nempel ke sesi ini (kalau ada) dan tampilin di
// panel "Kebutuhan RS", persis kayak saat baru disubmit — bedanya ini dipicu
// pas buka sesi, jadi berlaku juga buat temen yang bukan pembuat pertamanya.
async function loadChecklistForSesi(sesiId, opts) {
  const quiet = !!(opts && opts.quiet); // quiet: jangan pindahin tab / ganti item yang lagi kebuka (dipakai reload otomatis & abis edit)
  try {
    const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/get_permintaan_by_sesi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': S.ANON_KEY,
        'Authorization': 'Bearer ' + (await S.getFreshToken())
      },
      body: JSON.stringify({ p_sesi_id: sesiId })
    });
    if (!res.ok) { S.kbRefreshStatus.textContent = 'Gagal memuat checklist.'; return null; }
    const data = await res.json();
    if (!data) { S.kbRefreshStatus.textContent = ''; return null; } // sesi ini emang gak punya Permintaan RS

    S.checklistItems = Array.isArray(data.items) ? data.items : [];
    S.checklistItems.forEach(it => { it.matched_items = S.normalizeMatchedItems(it); });
    // section_id undefined di semua item (RPC belum di-update) = fallback aman,
    // grouping di bawah otomatis jadi 1 grup "Tanpa section" — gak ada yang patah.
    S.checklistSections = Array.isArray(data.sections)
      ? data.sections.slice().sort((a, b) => (a.urutan || 0) - (b.urutan || 0))
      : [];
    S.checklistNamaRs = data.nama_rs || '(tanpa nama RS)';
    S.checklistSales = data.pic_sales || '(tanpa nama sales)';
    S.checklistPagu = (data.pagu != null) ? data.pagu : S.checklistPagu;
    if (S.checklistPermintaanId !== data.permintaan_id) S.activeSectionTab = null; // ganti Permintaan RS → balik ke tab "Semua", jangan nyangkut di id section punya permintaan lama
    S.checklistPermintaanId = data.permintaan_id;
    // ASUMSI: field 'tanggal' ada di hasil RPC ini (sama kayak p_tanggal pas submit).
    // Kalau ternyata undefined terus (cek console: `checklistTanggal` selalu null padahal
    // Permintaan RS jelas ada), berarti RPC get_permintaan_by_sesi di server belum
    // nge-return kolom ini — perlu ditambahin di definisi function-nya di Supabase.
    S.checklistTanggal = data.tanggal || null;
    // Buka otomatis requirement PENDING pertama, biar langsung ada yang bisa
    // dikerjain begitu Kebutuhan RS ini tampil — bukan daftar kolaps semua.
    const firstPending = S.checklistItems.find(i => i.status === 'PENDING');
    const keepExpanded = quiet && S.checklistExpandedId != null && S.checklistItems.some(i => i.id === S.checklistExpandedId);
    if (!keepExpanded) S.checklistExpandedId = firstPending ? firstPending.id : null;

    S.kbSection.classList.remove('kb-collapsed');
    S.kbRecordStatus.textContent = 'Tingkat pemenuhan tersimpan otomatis tiap item ditandai.';
    S.kbRefreshStatus.textContent = 'Diperbarui ✓ ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    S.renderChecklist();
    S.maybeFetchSuggestionForExpanded();
    // Sesi ini punya Permintaan RS yang nempel — langsung arahkan ke tab
    // Kebutuhan RS, karena itu kemungkinan besar yang mau dicek duluan.
    if (!quiet) S.switchClipTab('kb');
    // Badge "RS n" di baris clipboard bergantung ke matched_items yang baru dimuat.
    S.updateClipboard();
    // Return = id Permintaan RS yang beneran kebaca dari server (dipakai buat verifikasi
    // persist setelah simpan/tambah, dan buat ngecek "sesi ini udah punya belum").
    return data.permintaan_id;
  } catch {
    S.kbRefreshStatus.textContent = 'Gagal memuat checklist.';
    return null;
  }
}
S.loadChecklistForSesi = loadChecklistForSesi;

// Refresh ringan badge jumlah sesi aktif tiap 30 detik, biar kelihatan
// walau lagi di tab Cari Produk — tanpa nge-reload seluruh daftar.
const __konvHeartbeatTimer = setInterval(async () => {
  if (!S.stokAccessToken) return;
  try {
    const res = await S.sesiFetch(`${S.SESI_TABLE}?status=eq.berjalan&select=id`);
    if (!res.ok) return;
    const rows = await res.json();
    S.sesiBadge.textContent = rows.length;
    S.sesiBadge.style.display = rows.length > 0 ? 'inline-block' : 'none';
  } catch { /* diamkan */ }
}, 30000);
S.__konvHeartbeatTimer = __konvHeartbeatTimer;

function updateClipHeaderCompact() {
  const rsRaw = S.inpRs.value.trim();
  const rs = rsRaw || '(nama RS belum diisi)';
  const sales = S.inpSales.value.trim();
  const marsup = S.inpMarsup.value.trim();
  // SECURITY FIX 2026-08-14: input ini diketik langsung oleh user (bukan dari
  // DB), tapi tetap wajib di-escape sebelum innerHTML — kalau enggak, orang
  // yang isi field ini bisa nginjek script yang jalan di browsernya sendiri
  // (dan kalau field ini ke-sync/keliatan kolaborator lain via Realtime,
  // jalan juga di browser mereka).
  S.clipHeaderCompact.innerHTML = `<b>${S.escapeHtmlAttr(rs)}</b>${sales ? ' · Sales: ' + S.escapeHtmlAttr(sales) : ''}${marsup ? ' · PIC: ' + S.escapeHtmlAttr(marsup) : ''}`;
  updateSessionIndicatorAndTitle(rsRaw, sales);
}
S.updateClipHeaderCompact = updateClipHeaderCompact;

// Satu sumber kebenaran "lagi di sesi/RS mana" yang SELALU kelihatan, di dua
// tempat: badge sticky di header global (nggak ikut hilang pas panel diciutkan
// atau di-scroll) dan judul tab browser (biar gampang bedain kalau buka
// beberapa tab untuk beberapa RS sekaligus).
function updateSessionIndicatorAndTitle(rsRaw, salesRaw) {
  // Aktif/enggaknya indikator sekarang ngikutin currentSesiId (fakta di server),
  // bukan cuma "ada nama RS yang diketik" — soalnya sesi bisa udah kebentuk
  // duluan (lewat "Mulai Sesi Baru") sebelum nama RS-nya sempat diisi.
  const hasSesi = !!S.currentSesiId;
  S.sessionIndicator.classList.toggle('empty', !hasSesi);
  S.sessionIndicator.classList.toggle('active', hasSesi);
  if (hasSesi) {
    const label = rsRaw ? (salesRaw ? `${rsRaw} · ${salesRaw}` : rsRaw) : 'Sesi baru (RS belum diisi)';
    S.sessionIndicatorText.textContent = label;
    document.title = rsRaw ? `${rsRaw} — Conversion Workspace` : S.APP_TITLE_BASE;
  } else {
    S.sessionIndicatorText.textContent = 'Belum ada sesi — klik "Mulai Sesi Baru"';
    document.title = S.APP_TITLE_BASE;
  }
}
const CLIP_HEADER_COLLAPSE_KEY = 'pnm_clip_header_collapsed';
function setClipHeaderCollapsed(collapsed, persist = true) {
  S.clipHeader.classList.toggle('collapsed', collapsed);
  S.clipHeaderToggle.title = collapsed ? 'Perluas form sesi' : 'Ciutkan form sesi';
  if (collapsed) updateClipHeaderCompact();
  if (persist) sessionStorage.setItem(CLIP_HEADER_COLLAPSE_KEY, collapsed ? '1' : '0');
}
S.setClipHeaderCollapsed = setClipHeaderCollapsed;
S.clipHeaderToggle.addEventListener('click', () => {
  setClipHeaderCollapsed(!S.clipHeader.classList.contains('collapsed'));
});
// Section tetap ciutan/terbuka selama masih di tab yang sama (sessionStorage),
// jadi gak perlu diulang tiap kali klik antar produk.
setClipHeaderCollapsed(sessionStorage.getItem(CLIP_HEADER_COLLAPSE_KEY) === '1', false);
[S.inpRs, S.inpSales, S.inpMarsup].forEach(inp => {
  inp.addEventListener('input', updateClipHeaderCompact);
});
const recordModal = document.getElementById('record-modal');
S.recordModal = recordModal;
const recTanggal = document.getElementById('rec-tanggal');
S.recTanggal = recTanggal;
const recRs = document.getElementById('rec-rs');
S.recRs = recRs;
const recSales = document.getElementById('rec-sales');
S.recSales = recSales;
const recKategori = document.getElementById('rec-kategori');
S.recKategori = recKategori;
const recValue = document.getElementById('rec-value');
S.recValue = recValue;
const recNotes = document.getElementById('rec-notes');
S.recNotes = recNotes;
const recLink = document.getElementById('rec-link');
S.recLink = recLink;
const recordStatus = document.getElementById('record-status');
S.recordStatus = recordStatus;
const recordSubmitBtn = document.getElementById('record-submit-btn');
S.recordSubmitBtn = recordSubmitBtn;
const recordCancelBtn = document.getElementById('record-cancel-btn');
S.recordCancelBtn = recordCancelBtn;
const exportModal = document.getElementById('export-modal');
S.exportModal = exportModal;

const btnPermintaan = document.getElementById('btn-permintaan');
S.btnPermintaan = btnPermintaan;
const prModal = document.getElementById('pr-modal');
S.prModal = prModal;
const prFormWrap = document.getElementById('pr-form-wrap');
S.prFormWrap = prFormWrap;
const prCancelBtn2 = document.getElementById('pr-cancel-btn-2');
S.prCancelBtn2 = prCancelBtn2;
const prNamaRs = document.getElementById('pr-nama-rs');
S.prNamaRs = prNamaRs;
const prTanggal = document.getElementById('pr-tanggal');
S.prTanggal = prTanggal;
const prPicSales = document.getElementById('pr-pic-sales');
S.prPicSales = prPicSales;
const prPagu = document.getElementById('pr-pagu');
S.prPagu = prPagu;

// Format input Pagu jadi "150.000.000" sambil ngetik, biar kebaca jelas —
// tapi tetep nerima keyboard numerik biasa (bukan input type=number yang suka nolak titik).
function parsePaguValue(str) {
  const digits = (str || '').replace(/\D/g, '');
  return digits ? Number(digits) : null;
}
S.parsePaguValue = parsePaguValue;
prPagu.addEventListener('input', () => {
  const digits = prPagu.value.replace(/\D/g, '');
  prPagu.value = digits ? Number(digits).toLocaleString('id-ID') : '';
});
const prTabTeks = document.getElementById('pr-tab-teks');
S.prTabTeks = prTabTeks;
const prTabExcel = document.getElementById('pr-tab-excel');
S.prTabExcel = prTabExcel;
const prTeksWrap = document.getElementById('pr-teks-wrap');
S.prTeksWrap = prTeksWrap;
const prExcelWrap = document.getElementById('pr-excel-wrap');
S.prExcelWrap = prExcelWrap;
const prTeks = document.getElementById('pr-teks');
S.prTeks = prTeks;
const prFile = document.getElementById('pr-file');
S.prFile = prFile;
const prSubmitBtn = document.getElementById('pr-submit-btn');
S.prSubmitBtn = prSubmitBtn;
const prStatusMsg = document.getElementById('pr-status-msg');
S.prStatusMsg = prStatusMsg;
const prReviewWrap = document.getElementById('pr-review-wrap');
S.prReviewWrap = prReviewWrap;
const prReviewInfo = document.getElementById('pr-review-info');
S.prReviewInfo = prReviewInfo;
const prReviewRows = document.getElementById('pr-review-rows');
S.prReviewRows = prReviewRows;
const prReviewAddBtn = document.getElementById('pr-review-add-btn');
S.prReviewAddBtn = prReviewAddBtn;
const prReviewBackBtn = document.getElementById('pr-review-back-btn');
S.prReviewBackBtn = prReviewBackBtn;
const prReviewSaveBtn = document.getElementById('pr-review-save-btn');
S.prReviewSaveBtn = prReviewSaveBtn;
}