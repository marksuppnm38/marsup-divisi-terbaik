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
// IDENTITAS PRESENCE/ACTIVITY/EDITING-INDICATOR = EMAIL LOGIN (S.currentUser dari
// Supabase Auth), BUKAN field PIC Marsup. PIC Marsup itu teks bebas yang bisa
// diisi/diganti siapa aja di sesi (dan ikut ke-sync ke semua kolaborator), jadi
// kalau dipakai sebagai identitas, bubble salah orang dan berubah tiap PIC diedit.
// Nama tampilan = bagian sebelum '@' dari email; email lengkap tetap dikirim di
// payload presence (buat tooltip & warna avatar yang stabil per user).
function emailLocalPart(email) {
  const e = String(email || '').trim();
  const at = e.indexOf('@');
  return (at > 0 ? e.slice(0, at) : e) || '';
}
function currentIdentity() {
  const u = S.currentUser;
  if (!u || !u.id || !u.email) return null;
  return { id: u.id, email: u.email, nama: emailLocalPart(u.email) };
}
function currentDisplayName() {
  const me = currentIdentity();
  return me ? me.nama : 'Anonim';
}
S.currentDisplayName = currentDisplayName;
// Nama yang ditampilin buat satu entri presence (milik orang lain ATAU diri sendiri).
// Sengaja diturunkan dari email di payload, bukan percaya mentah field `nama`.
// Nama pelaku buat activity feed, dari kolom created_by/updated_by yang diisi TRIGGER
// di database dari JWT login (bukan dari client — gak bisa dipalsukan, dan tetap akurat
// walau pelakunya sudah offline). Baris lama / update sistem (kolom null) → 'Kolaborator'.
function actorName(email) {
  const me = S.currentUser && S.currentUser.email;
  if (email && me && String(email).toLowerCase() === String(me).toLowerCase()) return 'Kamu'; // aksi sendiri juga tampil di feed
  return (email ? emailLocalPart(email) : '') || 'Kolaborator';
}
function displayNameOfPresence(p) {
  if (!p) return '';
  return (p.email ? emailLocalPart(p.email) : p.nama) || '';
}
S.sesiPresenceChannel = null;
let presenceRoster = {}; // presence key -> {user_id, email, nama, status, joined_at}
let presenceStatus = 'online'; // status terakhir yang kita track ('online' | 'away') — dipakai ulang tiap re-track/reconnect
// Snapshot "terakhir yang diketahui server" — dasar activity yang akurat (qty lama → baru,
// nilai header lama → baru) DAN buat aksi sendiri: di sisi pelaku UI lokal sudah berubah
// duluan (optimistic) sebelum event-nya balik, jadi bandingnya ke snapshot ini, bukan state lokal.
let qtyKnown = new Map();   // sesi_item id -> qty terakhir dari server
let sesiKnown = {};         // field sesi_konversi -> nilai terakhir dari server
const recentlyRemoved = new Map(); // kode_produk -> ts; cegah resync menghidupkan lagi item yang baru dihapus
const RECENT_REMOVE_TTL_MS = 15000;
let rtResyncing = false;
let hiddenAt = null;        // kapan tab mulai disembunyikan (buat resync pas balik)
let rtDownTimer = null;
let rtWasDown = false;
let presenceJoinedAt = null;   // dicap sekali per subscribe, BUKAN direset tiap online<->away (biar urutan avatar stabil)
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
  sesiDbChannel = dbChannel;
  seedKnownState();
  dbChannel.subscribe((status) => {
    if (sesiDbChannel !== dbChannel) return; // callback telat dari channel lama (sesi sudah ganti/keluar) — jangan ngubah status UI
    if (status === 'SUBSCRIBED') {
      updateRtStatus('live');
      clearTimeout(rtDownTimer); rtDownTimer = null;
      const wasDown = rtWasDown; rtWasDown = false;
      // Event yang lewat pas socket putus (atau di celah antara load sesi & SUBSCRIBED)
      // GAK dikirim ulang oleh Supabase — tarik state terbaru dari server.
      resyncSesi().then(() => {
        if (wasDown && sesiDbChannel === dbChannel) S.showToast('Koneksi live tersambung lagi', 'success');
      });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      updateRtStatus(status === 'CLOSED' ? 'offline' : 'reconnecting');
      // Putus sebentar (hitungan detik) gak perlu berisik — baru kasih tau kalau >6 detik.
      if (!rtDownTimer) rtDownTimer = setTimeout(() => {
        rtDownTimer = null;
        if (sesiDbChannel === dbChannel && rtConnState !== 'live') {
          rtWasDown = true;
          S.showToast('Koneksi live terputus — menyambung ulang…', 'error');
        }
      }, 6000);
    }
  });

  // Key presence = auth user id (stabil, unik per akun; beberapa tab akun yang sama
  // jadi satu orang di roster). Kalau belum ada user (seharusnya mustahil karena
  // router sudah gate login), channel tetap dipasang buat broadcast tapi TIDAK
  // di-track — jadi gak ada bubble "anon" siluman.
  const me = currentIdentity();
  const presenceKey = me ? me.id : ('anon-' + Math.random().toString(36).slice(2, 9));
  presenceJoinedAt = new Date().toISOString();
  presenceStatus = document.hidden ? 'away' : 'online';
  const presenceChannel = S.rt.channel(`sesi-presence-${sesiId}`, { config: { private: true, presence: { key: presenceKey } } })
    .on('presence', { event: 'sync' }, handlePresenceSync)
    .on('presence', { event: 'join' }, handlePresenceJoin)
    .on('presence', { event: 'leave' }, handlePresenceLeave)
    .on('broadcast', { event: 'item_removed' }, handleItemRemovedBroadcast)
    .on('broadcast', { event: 'checklist_item_updated' }, handleChecklistItemUpdatedBroadcast)
    .on('broadcast', { event: 'checklist_reload' }, handleChecklistReloadBroadcast)
    .on('broadcast', { event: 'editing' }, S.handleEditingBroadcast)
    .on('broadcast', { event: 'editing_stop' }, S.handleEditingStopBroadcast);
  S.sesiPresenceChannel = presenceChannel;
  presenceChannel.subscribe((status) => {
    if (S.sesiPresenceChannel !== presenceChannel) return; // channel basi, abaikan
    // Dipanggil lagi tiap SUBSCRIBED (termasuk setelah reconnect) → identitas
    // ke-track ulang otomatis, bubble gak hilang diam-diam abis koneksi putus.
    if (status === 'SUBSCRIBED') trackPresence();
  });

  // Away kalau tab disembunyikan >30 detik — kembali online begitu dibuka lagi.
  document.addEventListener('visibilitychange', handleVisibilityForPresence);
  window.addEventListener('offline', handleBrowserOffline);
  window.addEventListener('online', handleBrowserOnline);
}
S.subscribeToSesiRealtime = subscribeToSesiRealtime;

// Satu-satunya pintu track() — payload selalu dibangun dari email login.
// Mengembalikan false kalau gak ada identitas / channel (gak ada yang di-track).
async function trackPresence(status) {
  if (status) presenceStatus = status;
  const ch = S.sesiPresenceChannel;
  const me = currentIdentity();
  if (!ch || !me) return false;
  try {
    await ch.track({
      user_id: me.id,
      email: me.email,
      nama: me.nama,
      status: presenceStatus,
      joined_at: presenceJoinedAt || (presenceJoinedAt = new Date().toISOString())
    });
    return true;
  } catch { /* presence gagal gak boleh nge-block kerjaan utama */ return false; }
}
// Dipanggil kalau identitas login berubah di tengah sesi (mis. USER_UPDATED).
S.refreshPresenceIdentity = () => trackPresence();

let awayTimer = null;
const RESYNC_AFTER_HIDDEN_MS = 20000;
function handleVisibilityForPresence() {
  if (!S.sesiPresenceChannel) return;
  clearTimeout(awayTimer);
  if (document.hidden) {
    hiddenAt = Date.now();
    awayTimer = setTimeout(() => { trackPresence('away'); }, 30000);
  } else {
    trackPresence('online');
    // Tab baru balik kelihatan — jangan andelin TOKEN_REFRESHED (bisa telat/
    // ke-throttle browser pas tab tadi di-background), paksa re-sync token
    // realtime di sini juga biar postgres_changes gak kena filter diam-diam
    // gara-gara token basi (lihat komentar di syncRealtimeAuth()).
    S.syncRealtimeAuth();
    // Tab di-background lama: browser bisa nge-throttle socket, event bisa kelewat → tarik state terbaru.
    if (hiddenAt && Date.now() - hiddenAt > RESYNC_AFTER_HIDDEN_MS) resyncSesi();
    hiddenAt = null;
  }
}
function handleBrowserOffline() { if (S.currentSesiId) updateRtStatus('reconnecting'); }
function handleBrowserOnline() { S.syncRealtimeAuth(); } // SDK reconnect sendiri → SUBSCRIBED → resyncSesi()

function unsubscribeFromSesiRealtime() {
  document.removeEventListener('visibilitychange', handleVisibilityForPresence);
  window.removeEventListener('offline', handleBrowserOffline);
  window.removeEventListener('online', handleBrowserOnline);
  clearTimeout(awayTimer);
  clearTimeout(rtDownTimer); rtDownTimer = null; rtWasDown = false;
  hiddenAt = null;
  qtyKnown = new Map(); sesiKnown = {}; recentlyRemoved.clear();
  const oldDb = sesiDbChannel;
  const oldPresence = S.sesiPresenceChannel;
  // Null-kan DULU sebelum removeChannel, supaya callback status yang masih
  // nyangkut dari channel lama gagal lolos guard `=== channel` di subscribe.
  sesiDbChannel = null;
  S.sesiPresenceChannel = null;
  if (oldPresence) { try { oldPresence.untrack(); } catch { /* best-effort: leave tetap dikirim removeChannel */ } }
  if (S.rt && oldDb) S.rt.removeChannel(oldDb);
  if (S.rt && oldPresence) S.rt.removeChannel(oldPresence);
  presenceJoinedAt = null;
  presenceStatus = 'online';
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

// Isi snapshot awal dari state lokal yang baru saja dimuat dari server (openSesi/ensureSesi).
function seedKnownState() {
  qtyKnown = new Map();
  (S.clipboard || []).forEach(c => { if (c._sesiItemId != null) qtyKnown.set(c._sesiItemId, Number(c.qty)); });
  sesiKnown = {
    nama_rs: S.inpRs ? S.inpRs.value : '',
    nama_sales: S.inpSales ? S.inpSales.value : '',
    pic_marsup: S.inpMarsup ? S.inpMarsup.value : '',
    pagu: S.checklistPagu != null ? S.checklistPagu : null,
    butuh_bantuan: !!S.currentButuhBantuan,
    mode_harga_swasta: !!S.modeSwastaOutput,
    status: 'berjalan'
  };
}
const normNum = (v) => (v == null || v === '' ? null : Number(v));
const SESI_FIELD_LABELS = { nama_rs: 'Nama RS', nama_sales: 'Nama Sales', pic_marsup: 'PIC Marsup' };

// ---- Handler: baris sesi_konversi berubah (header/pagu/status/butuh_bantuan) ----
function handleSesiRowChange(payload) {
  if (payload.eventType === 'DELETE') return; // dihapus ditangani lewat alur hapus sesi yang sudah ada
  const row = payload.new;
  if (!row || row.id !== S.currentSesiId) return;
  applySesiRow(row, { silent: false });
}
// Dipakai event realtime DAN resync. silent=true → terapkan ke UI tanpa nulis activity.
// Dua urusan dipisah: (1) nerapin ke UI — di-skip kalau gema tulisan sendiri / lagi difokus;
// (2) activity — selalu, dibandingkan ke snapshot server, jadi aksi sendiri juga masuk feed.
function applySesiRow(row, opts) {
  const silent = !!(opts && opts.silent);
  const actor = actorName(row.updated_by);
  const prev = sesiKnown;
  let headerTouched = false;

  Object.keys(SESI_FIELD_LABELS).forEach(field => {
    const el = field === 'nama_rs' ? S.inpRs : field === 'nama_sales' ? S.inpSales : S.inpMarsup;
    const newVal = row[field] || '';
    // Jangan timpa field yang LAGI DIFOKUS user lokal (lagi diketik).
    if (el && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, field, row[field]) && document.activeElement !== el && el.value !== newVal) {
      el.value = newVal;
      headerTouched = true;
      el.classList.add('rt-field-pulse');
      setTimeout(() => el.classList.remove('rt-field-pulse'), 1100);
    }
    if (!silent && prev[field] !== undefined && prev[field] !== newVal) {
      pushGrouped(`hdr:${actor}:${field}`, { label: SESI_FIELD_LABELS[field], val: newVal },
        (a, b) => b,
        d => `${actor} mengubah ${d.label}${d.val ? ' jadi "' + (d.val.length > 40 ? d.val.slice(0, 40) + '…' : d.val) + '"' : ' (dikosongkan)'}`);
    }
    prev[field] = newVal;
  });
  if (headerTouched && typeof S.updateClipHeaderCompact === 'function') S.updateClipHeaderCompact(); // strip/judul tab ikut segar

  if (row.pagu !== S.checklistPagu && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, 'pagu', row.pagu)) {
    S.checklistPagu = row.pagu;
    S.updateClipAggregates(); // cuma hitung ulang total/budget, gak nyentuh daftar item
  }
  if (!silent && normNum(prev.pagu) !== normNum(row.pagu)) pushActivity(`${actor} mengubah pagu`);
  prev.pagu = row.pagu != null ? row.pagu : null;

  if (!!row.butuh_bantuan !== S.currentButuhBantuan && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, 'butuh_bantuan', row.butuh_bantuan)) {
    S.currentButuhBantuan = !!row.butuh_bantuan;
    if (typeof S.renderButuhBantuanBtn === 'function') S.renderButuhBantuanBtn();
  }
  if (!silent && !!prev.butuh_bantuan !== !!row.butuh_bantuan) {
    pushActivity(`${actor} ${row.butuh_bantuan ? 'meminta bantuan' : 'membatalkan permintaan bantuan'}`);
  }
  prev.butuh_bantuan = !!row.butuh_bantuan;

  // Mode harga (E-Katalog/Swasta) ditetapkan pembuat sesi — kolaborator lain harus
  // ikut, bukan mulai dari default lokal masing-masing.
  if (!!row.mode_harga_swasta !== S.modeSwastaOutput && !isEchoOfLocalWrite(S.SESI_TABLE, row.id, 'mode_harga_swasta', row.mode_harga_swasta)) {
    S.setModeSwastaOutput(!!row.mode_harga_swasta);
  }
  if (!silent && !!prev.mode_harga_swasta !== !!row.mode_harga_swasta) {
    pushActivity(`${actor} mengubah mode harga ke ${row.mode_harga_swasta ? 'Swasta' : 'E-Katalog'}`);
  }
  prev.mode_harga_swasta = !!row.mode_harga_swasta;

  if (!silent && row.status && prev.status !== row.status && row.status !== 'berjalan') {
    pushActivity(`${actor} menyelesaikan sesi ini`);
  }
  if (row.status) prev.status = row.status;
}

// ---- Handler: baris sesi_konversi_item berubah (isi clipboard) ----
function handleItemRowChange(payload) {
  if (!S.currentSesiId) return;

  // PENTING soal DELETE: Supabase Postgres Changes SECARA RESMI gak nge-filter
  // event DELETE di server sama sekali (beda dari INSERT/UPDATE) — lihat
  // https://supabase.com/docs/guides/realtime/postgres-changes#delete-events-are-not-filterable
  // Ditambah lagi payload.old default-nya cuma isi primary key (`id`), gak ada
  // sesi_id, jadi filter `row.sesi_id !== currentSesiId` GAK BISA dipakai buat
  // DELETE. Solusinya: DELETE difilter dari sisi client pakai keanggotaan di
  // clipboard LOKAL kita (yang emang udah pasti isinya cuma item sesi ini).
  if (payload.eventType === 'DELETE') {
    const row = payload.old;
    if (!row || row.id == null) return;
    const item = S.clipboard.find(c => c._sesiItemId === row.id);
    qtyKnown.delete(row.id);
    if (!item) return; // bukan item sesi ini, atau emang udah kehapus lokal duluan (optimistic)
    const nama = item.nama_produk;
    noteRemoved(item.kode_produk);
    S.removeClipItemDom(item.kode_produk);
    pushRemovedActivity('Kolaborator', nama);
    return;
  }

  // INSERT & UPDATE difilter server-side dengan benar (payload.new selalu lengkap),
  // baris di bawah cuma jaga-jaga kalau ada race/event nyasar.
  const row = payload.new;
  if (!row || row.sesi_id !== S.currentSesiId) return;

  if (payload.eventType === 'INSERT') {
    qtyKnown.set(row.id, Number(row.qty));
    const actor = actorName(row.created_by || row.updated_by);
    // kode_produk unik per clipboard (dipakai jadi key di mana-mana). Kalau sudah ada
    // = gema tambahan sendiri (UI lokal udah duluan) → gak perlu insert DOM, tapi
    // tetap dicatat di feed supaya pelaku juga lihat aktivitasnya.
    if (!S.clipboard.some(c => c.kode_produk === row.kode_produk)) {
      S.insertClipItem(S.mapSesiItemRowToClipItem(row));
    }
    pushGrouped(`add:${actor}`, { first: row.nama_produk, n: 1 },
      (a, b) => ({ first: a.first, n: a.n + b.n }),
      d => d.n === 1 ? `${actor} menambahkan ${d.first}` : `${actor} menambahkan ${d.first} dan ${d.n - 1} item lain`);
    return;
  }
  if (payload.eventType === 'UPDATE') {
    const item = S.clipboard.find(c => c._sesiItemId === row.id);
    const prevQty = qtyKnown.get(row.id);
    qtyKnown.set(row.id, Number(row.qty));
    if (!item) { S.insertClipItem(S.mapSesiItemRowToClipItem(row)); return; }
    const echo = isEchoOfLocalWrite(S.SESI_ITEM_TABLE, row.id, 'qty', row.qty);
    const localQty = Number(item.qty);
    if (Number(row.qty) !== localQty && !echo) S.patchClipItem(item.kode_produk, { qty: row.qty });
    // qty lama: dari snapshot server; kalau belum ada & ini bukan gema, pakai qty lokal sebelum dipatch.
    const from = prevQty !== undefined ? prevQty : (echo ? undefined : localQty);
    const to = Number(row.qty);
    if (from !== undefined && from !== to) {
      const actor = actorName(row.updated_by);
      pushGrouped(`qty:${actor}:${row.id}`, { nama: item.nama_produk, from, to },
        (a, b) => ({ nama: a.nama, from: a.from, to: b.to }),
        d => `${actor} mengubah qty ${d.nama} ${d.from} → ${d.to}`);
    }
  }
}

// ---- Resync: tarik state terbaru dari server lalu samakan UI ----
// Dipanggil tiap channel SUBSCRIBED (pertama kali & tiap reconnect) dan pas tab balik
// setelah lama di-background. Supabase gak mengirim ulang event yang lewat saat socket
// putus, jadi tanpa ini tampilan bisa diam-diam beda dari kolaborator sampai di-refresh.
// Aman terhadap race: tidak menyentuh item yang baru ditulis/dihapus lokal.
function noteRemoved(kode) { if (kode) recentlyRemoved.set(kode, Date.now()); }
function wasRecentlyRemoved(kode) {
  const t = recentlyRemoved.get(kode);
  if (t == null) return false;
  if (Date.now() - t > RECENT_REMOVE_TTL_MS) { recentlyRemoved.delete(kode); return false; }
  return true;
}
function hasRecentLocalQtyWrite(itemId) {
  const rec = recentLocalWrites.get(`${S.SESI_ITEM_TABLE}:${itemId}:qty`);
  return !!rec && Date.now() - rec.ts <= RECENT_WRITE_TTL_MS;
}
async function resyncSesi() {
  const sesiId = S.currentSesiId;
  if (!sesiId || rtResyncing || typeof S.sesiFetch !== 'function') return;
  rtResyncing = true;
  try {
    const knownBefore = new Set(qtyKnown.keys()); // item yang sudah kita kenal SEBELUM fetch dimulai
    const idSafe = encodeURIComponent(sesiId);
    const [sesiRes, itemsRes] = await Promise.all([
      S.sesiFetch(`${S.SESI_TABLE}?id=eq.${idSafe}&select=*`),
      S.sesiFetch(`${S.SESI_ITEM_TABLE}?sesi_id=eq.${idSafe}&select=*`)
    ]);
    if (!sesiRes.ok || !itemsRes.ok) return; // gagal → biarkan, resync berikutnya nyoba lagi
    const [rows, items] = await Promise.all([sesiRes.json(), itemsRes.json()]);
    if (S.currentSesiId !== sesiId) return; // pindah/keluar sesi selagi fetch jalan

    if (rows[0]) applySesiRow(rows[0], { silent: true });

    const serverIds = new Set();
    items.forEach(it => {
      serverIds.add(it.id);
      qtyKnown.set(it.id, Number(it.qty));
      const local = S.clipboard.find(c => c._sesiItemId === it.id);
      if (!local) {
        if (!S.clipboard.some(c => c.kode_produk === it.kode_produk) && !wasRecentlyRemoved(it.kode_produk)) {
          S.insertClipItem(S.mapSesiItemRowToClipItem(it));
        }
      } else if (Number(local.qty) !== Number(it.qty) && !hasRecentLocalQtyWrite(it.id)) {
        S.patchClipItem(local.kode_produk, { qty: it.qty });
      }
    });
    // Item yang sudah kita kenal tapi hilang di server = dihapus orang lain pas kita putus.
    // Item baru (belum ada di knownBefore, mis. baru kita tambah) TIDAK disentuh.
    (S.clipboard || []).slice().forEach(c => {
      if (c._sesiItemId != null && knownBefore.has(c._sesiItemId) && !serverIds.has(c._sesiItemId)) {
        qtyKnown.delete(c._sesiItemId);
        noteRemoved(c.kode_produk);
        S.removeClipItemDom(c.kode_produk);
      }
    });
    // Checklist Kebutuhan RS dikirim lewat broadcast (gak ada replay) — muat ulang juga.
    if (typeof S.loadChecklistForSesi === 'function') S.loadChecklistForSesi(sesiId, { quiet: true });
  } catch { /* resync gagal gak boleh ganggu kerjaan — event live berikutnya tetap jalan */ }
  finally { rtResyncing = false; }
}

// ---- Penghapusan item: Broadcast manual, bukan andelin postgres_changes DELETE ----
// LATAR BELAKANG: postgres_changes event DELETE terbukti gak reliable di Supabase
// Realtime buat setup ini — udah dicek satu-satu (publication, RLS, replica identity,
// bahkan SQL DELETE langsung dari SQL Editor) dan semuanya benar, tapi event-nya tetep
// gak pernah nyampe. Ini match sama bug yang udah lama dilaporin di beberapa repo
// Supabase (INSERT/UPDATE jalan, DELETE diem) — bukan salah konfigurasi kita. Makanya
// penghapusan disiarin manual lewat Broadcast (send/on, bukan postgres_changes), yang
// justru direkomendasikan Supabase sendiri buat use-case yang butuh reliability.
function pushRemovedActivity(actor, nama) {
  pushGrouped(`rm:${actor}`, { first: nama, n: 1 },
    (a, b) => ({ first: a.first, n: a.n + b.n }),
    d => d.n === 1 ? `${actor} menghapus ${d.first}` : `${actor} menghapus ${d.first} dan ${d.n - 1} item lain`);
}
function broadcastItemRemoved(item) {
  noteRemoved(item.kode_produk);
  if (item._sesiItemId != null) qtyKnown.delete(item._sesiItemId);
  pushRemovedActivity('Kamu', item.nama_produk); // aksi sendiri juga masuk feed (broadcast gak balik ke pengirim)
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
  noteRemoved(item.kode_produk);
  if (item._sesiItemId != null) qtyKnown.delete(item._sesiItemId);
  S.removeClipItemDom(item.kode_produk);
  pushRemovedActivity(payload.actor || 'Kolaborator', payload.nama_produk || item.nama_produk);
}

// ---- Update status item Kebutuhan RS: Broadcast manual, sama kayak pola DELETE
// clipboard di atas ----
// LATAR BELAKANG: postgres_changes buat tabel permintaan_item kena berlapis-lapis
// masalah di setup ini (auth Realtime kepeleset ke anon, kolom filter permintaan_id
// gak ke-index, dst) — daripada terus gantung ke situ, status item disiarin manual
// lewat Broadcast begitu update ke server sukses, persis pola yang udah kebukti
// reliable buat clipboard.
function checklistStatusLabel(status) {
  return status === 'TERPENUHI' ? 'bisa dipenuhi' : status === 'TIDAK_TERPENUHI' ? 'tidak bisa dipenuhi' : 'PENDING lagi';
}
function broadcastChecklistItemUpdated(item) {
  pushActivity(`Kamu menandai "${item.raw_text}" ${checklistStatusLabel(item.status)}`); // aksi sendiri juga masuk feed
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
  pushGrouped('cl-reload:Kamu', 1, (a, b) => a, () => 'Kamu mengubah daftar Permintaan RS');
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
  const who = payload && payload.actor ? payload.actor : null;
  pushGrouped(`cl-reload:${who || '?'}`, 1, (a, b) => a, () => `${who ? who + ' mengubah' : 'Ada perubahan pada'} daftar Permintaan RS`);
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
    const label = checklistStatusLabel(payload.status);
    const actor = payload.actor ? payload.actor + ' menandai ' : '';
    pushActivity(`${actor}"${payload.raw_text || item.raw_text}" ${label}`);
  }
}

// ---- Activity feed ringan (in-memory, dicap 8 entri terakhir) ----
function pushActivity(msg) {
  rtActivityLog.unshift({ ts: new Date(), t: Date.now(), msg });
  if (rtActivityLog.length > 8) rtActivityLog.length = 8;
  renderActivityFeed();
}
// Aksi beruntun dari orang yang sama (tambah 12 item, ubah qty 3→2→1, ngetik Nama RS)
// digabung jadi SATU baris, biar feed (dicap 8) gak banjir dan gak menggeser info penting.
// Hanya digabung dengan baris paling atas, dalam jendela 4 detik.
const ACTIVITY_GROUP_WINDOW_MS = 4000;
function pushGrouped(key, data, merge, fmt) {
  const now = Date.now();
  const top = rtActivityLog[0];
  if (top && top.key === key && now - top.t < ACTIVITY_GROUP_WINDOW_MS) {
    top.data = merge(top.data, data);
    top.msg = fmt(top.data);
    top.t = now;
    top.ts = new Date();
    renderActivityFeed();
    return;
  }
  rtActivityLog.unshift({ ts: new Date(), t: now, key, data, msg: fmt(data) });
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
    return `<div${i === 0 ? ' class="rt-fade-in"' : ''} style="padding:2px 0">${hh}:${mm} — ${S.escapeHtmlAttr(a.msg)}</div>`;
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
    const entries = (state[key] || []).filter(e => e && (e.email || e.nama));
    if (!entries.length) return;
    // Satu akun bisa punya beberapa tab: tampilkan sebagai SATU orang. Pakai
    // entri terbaru, tapi statusnya 'online' kalau ada tab yang masih online
    // (jangan sampai satu tab background bikin orangnya kelihatan away).
    const latest = entries[entries.length - 1];
    const anyOnline = entries.some(e => e.status !== 'away');
    roster[key] = Object.assign({}, latest, { status: anyOnline ? 'online' : 'away' });
  });
  presenceRoster = roster;
  renderPresenceRoster();
}
function isSelfKey(key) {
  return !!(S.currentUser && key === S.currentUser.id);
}
function handlePresenceJoin({ key, currentPresences, newPresences }) {
  if (isSelfKey(key)) return; // diri sendiri, gak usah notif
  // track() ulang (online<->away) atau tab kedua akun yang sama juga muncul sebagai
  // 'join' — itu bukan orang baru. Cuma notif kalau key ini sebelumnya belum ada.
  if (currentPresences && currentPresences.length) return;
  const nama = displayNameOfPresence(newPresences && newPresences[0]);
  if (nama) S.showToast(`${nama} bergabung ke sesi ini`, 'presence');
}
function handlePresenceLeave({ key, leftPresences }) {
  if (isSelfKey(key)) return;
  // Masih ada tab/meta lain dengan key sama → bukan beneran keluar (mis. cuma ganti status).
  const still = S.sesiPresenceChannel && S.sesiPresenceChannel.presenceState()[key];
  if (still && still.length) return;
  const nama = displayNameOfPresence(leftPresences && leftPresences[0]);
  if (nama) S.showToast(`${nama} keluar dari sesi`, 'presence');
}
const RT_AVATAR_PALETTE = ['#e5484d', '#f76b15', '#ffb224', '#46a758', '#12a594', '#0091ff', '#8e4ec6', '#e93d82'];
function avatarColorFor(seed) {
  seed = String(seed || '');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return RT_AVATAR_PALETTE[hash % RT_AVATAR_PALETTE.length];
}
function initialsFor(nama) {
  // Pecah di spasi/titik/underscore/strip/plus — "stephanus.sabd" → "SS",
  // "stephanussabd" (satu kata) → 2 huruf pertama "ST".
  const parts = String(nama || '').trim().split(/[\s._\-+]+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
const RT_STATUS_LABELS = { connecting: 'Menyambungkan…', live: 'Live', reconnecting: 'Menyambung ulang…', offline: 'Offline' };
function renderPresenceRoster() {
  const wrap = document.getElementById('rt-live');
  const cluster = document.getElementById('rt-avatar-cluster');
  if (!wrap || !cluster) return;
  // Diri sendiri dulu, sisanya urut siapa yang masuk duluan — urutan stabil, gak loncat tiap sync.
  const entries = Object.keys(presenceRoster)
    .map(key => ({ key, p: presenceRoster[key] }))
    .filter(e => displayNameOfPresence(e.p))
    .sort((a, b) => {
      const sa = isSelfKey(a.key) ? 0 : 1, sb = isSelfKey(b.key) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return String(a.p.joined_at || '').localeCompare(String(b.p.joined_at || '')) || a.key.localeCompare(b.key);
    });
  const MAX_SHOWN = 4;
  const shown = entries.slice(0, MAX_SHOWN);
  const overflow = entries.length - shown.length;
  cluster.innerHTML = shown.map(({ key, p }) => {
    const awayCls = p.status === 'away' ? ' away' : '';
    const nama = displayNameOfPresence(p);
    const label = (p.email || nama) + (isSelfKey(key) ? ' (kamu)' : '') + (p.status === 'away' ? ' — away' : '');
    return `<span class="rt-avatar${awayCls}" title="${S.escapeHtmlAttr(label)}" style="background:${avatarColorFor(p.email || nama)}">${S.escapeHtmlAttr(initialsFor(nama))}</span>`;
  }).join('') + (overflow > 0 ? `<span class="rt-avatar-more">+${overflow}</span>` : '');
  const names = entries.map(({ key, p }) => (p.email || displayNameOfPresence(p)) + (isSelfKey(key) ? ' (kamu)' : '') + (p.status === 'away' ? ' (away)' : ''));
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

// Badge jumlah sesi aktif (S.sesiBadge) — GANTI dari poll setInterval 30 detik
// (versi lama, lihat COORD LOG index.js kalau perlu riwayatnya) jadi live dari
// Realtime, per instruksi audit. Beda dari channel sesi-db-${sesiId} di atas:
// channel ini SENGAJA TIDAK difilter per sesi, karena badge ini butuh tau
// TOTAL sesi 'berjalan' di seluruh tim — termasuk pas user belum/gak lagi
// buka sesi manapun (mis. lagi di tab Cari Produk, sama seperti niat poll
// lama) — jadi hidup dari mount() sampai unmount() halaman ini, BUKAN
// ngikutin siklus currentSesiId kayak sesi-db-*/sesi-presence-*.
//
// AMAN dari bug postgres_changes DELETE yang gak reliable di setup ini
// (lihat catatan broadcastItemRemoved di atas): sesi TIDAK PERNAH di-hard-
// DELETE selama masih 'berjalan' — "Selesaikan Sesi" itu UPDATE status jadi
// 'selesai' dulu (lihat endSesi() dkk di index.js/clipboard.js), baru bisa
// dihapus permanen (deleteSesi(), DELETE beneran) belakangan dari layar
// Riwayat SETELAH statusnya sudah 'selesai' — jadi baris yang lagi dihitung
// badge ini (status='berjalan') gak pernah hilang lewat jalur DELETE yang
// bermasalah itu. INSERT+UPDATE saja sudah cukup buat itung badge; event
// DELETE tetap ditangani di bawah kalau kebetulan nyampe (bonus, bukan
// disandarkan).
//
// Tetap ada resync fallback tiap 5 menit (JAUH lebih jarang dari poll lama
// 30 detik, dan lewat REST/sesiFetch — bukan socket Realtime) sebagai jaring
// pengaman kalau koneksi sempat putus/reconnect dan ada event yang kelewat
// di antaranya, atau token socket Realtime sempat basi (lihat komentar
// syncRealtimeAuth() di index.js) — REST-nya sendiri selalu ambil token
// fresh lewat sesiFetch, jadi tetap self-healing walau socket-nya diam.
const activeSesiIds = new Set();
let sesiCountChannel = null;
let sesiCountResyncTimer = null;

function renderSesiBadge() {
  if (!S.sesiBadge) return;
  S.sesiBadge.textContent = activeSesiIds.size;
  S.sesiBadge.style.display = activeSesiIds.size > 0 ? 'inline-block' : 'none';
}

async function hydrateSesiCount() {
  if (!S.stokAccessToken) return;
  try {
    const res = await S.sesiFetch(`${S.SESI_TABLE}?status=eq.berjalan&select=id`);
    if (!res.ok) return;
    const rows = await res.json();
    activeSesiIds.clear();
    rows.forEach((r) => activeSesiIds.add(r.id));
    renderSesiBadge();
  } catch { /* diamkan — badge tetap nunjukin angka terakhir yang diketahui, resync berikutnya nyoba lagi */ }
}

function handleSesiCountChange(payload) {
  const newRow = payload.new && Object.keys(payload.new).length ? payload.new : null;
  const oldRow = payload.old && Object.keys(payload.old).length ? payload.old : null;
  if (payload.eventType === 'DELETE') {
    if (oldRow) activeSesiIds.delete(oldRow.id); // bonus, lihat catatan di atas — jangan disandarkan
  } else if (newRow) {
    if (newRow.status === 'berjalan') activeSesiIds.add(newRow.id);
    else activeSesiIds.delete(newRow.id); // transisi keluar dari 'berjalan' (mis. jadi 'selesai') = keluar dari hitungan
  }
  renderSesiBadge();
}

function initSesiCountLive() {
  hydrateSesiCount(); // snapshot awal, independen dari status channel di bawah — badge langsung ada angkanya begitu token siap
  if (!S.rt) return; // SDK Realtime gagal dimuat — badge tetap kepasang dari snapshot di atas, cuma gak live-update lagi sampai resync 5 menit berikutnya
  S.syncRealtimeAuth(); // sama kayak sesi-db-* — pastiin socket Realtime pakai token authenticated, bukan anon (lihat komentar syncRealtimeAuth())
  sesiCountChannel = S.rt.channel('konv-sesi-count')
    .on('postgres_changes', { event: '*', schema: 'public', table: S.SESI_TABLE }, handleSesiCountChange)
    .subscribe((status) => { if (status === 'SUBSCRIBED') hydrateSesiCount(); }); // re-snapshot pas (re)connect, nutup celah event yang kelewat pas socket sempat putus
  sesiCountResyncTimer = setInterval(hydrateSesiCount, 5 * 60 * 1000);
}
initSesiCountLive();

function cleanupSesiCountLive() {
  if (sesiCountChannel) { S.rt?.removeChannel(sesiCountChannel); sesiCountChannel = null; }
  if (sesiCountResyncTimer) { clearInterval(sesiCountResyncTimer); sesiCountResyncTimer = null; }
}
S.__konvSesiCountCleanup = cleanupSesiCountLive;

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