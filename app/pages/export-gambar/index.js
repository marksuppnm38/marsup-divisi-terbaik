// export-gambar page module: mount(container) / unmount().
// Logic below is the original export-gambar-gabungan.html script, transformed per
// map.md's per-page checklist:
//   - DOM lookups scoped to `container` instead of `document`.
//   - Manual sb.auth.* calls replaced with PNMAuth.* (this page was "setengah jalan":
//     it already used the shared pnmSupabase client for URL/anon-key, but was still
//     calling sb.auth.signInWithPassword/signOut/onAuthStateChange/getSession
//     directly instead of going through shared/auth-session.js).
//   - sb.from('allowed_users') query kept as direct pnmSupabase call on purpose —
//     PNMAuth only wraps session management, not arbitrary table/storage queries
//     (see shared/auth-session.js's own header comment).
//   - This page's own local toast()/#toastRoot system is NOT the same as
//     shared/toast.js (PNMToast) — it's a third, page-specific implementation with
//     its own CSS tied to this page's dark "glass" theme. Left as-is; unifying it
//     with PNMToast is a separate decision, not part of this migration step.

import { EXPORT_GAMBAR_MARKUP } from './markup.js';

const VENDOR_SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  '/shared/supabase-client.js',
  '/shared/auth-session.js',
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat ' + src));
    document.head.appendChild(s);
  });
}

let vendorReady = null;
function ensureVendorScripts() {
  // These are classic (non-module) scripts that build on each other via globals
  // (window.supabase -> window.pnmSupabase -> window.PNMAuth), so they must load
  // strictly in order — unlike kompres-pdf's independent vendor libs, these can't
  // be Promise.all'd.
  if (window.PNMAuth && window.pnmSupabase) return Promise.resolve();
  if (!vendorReady) {
    vendorReady = VENDOR_SCRIPTS.reduce(
      (chain, src) => chain.then(() => loadScript(src)),
      Promise.resolve()
    );
  }
  return vendorReady;
}

function ensureStyle() {
  if (document.getElementById('page-export-gambar-style')) return;
  const link = document.createElement('link');
  link.id = 'page-export-gambar-style';
  link.rel = 'stylesheet';
  link.href = new URL('./style.css', import.meta.url).href;
  document.head.appendChild(link);
}

let mountedContainer = null;
let activeObserver = null;
let authUnsubscribe = null;

export async function mount(container) {
  mountedContainer = container;
  ensureStyle();
  await ensureVendorScripts();
  container.innerHTML = EXPORT_GAMBAR_MARKUP;

      // Sumber gambar sekarang Supabase Storage bucket "thumbnails" (public, key by
      // kode_asli). URL/anon key project sendiri memang publik (dilindungi RLS di server)
      // dan sudah tersedia dari shared/supabase-client.js — jadi dipakai dari situ langsung,
      // gak perlu dobel-declare di sini.
      const SUPABASE_URL = window.PNM_SUPABASE_URL;
      const THUMBNAILS_BUCKET = "thumbnails";
      const TEMPLATE_URL = `${SUPABASE_URL}/storage/v1/object/public/${THUMBNAILS_BUCKET}/TEMPLATE_THUMBNAIL_ROBUST.png`;
  
      const sb = window.pnmSupabase;
  
      // ── Auth gate — sama persis pola shared-auth di crud-produk.html, jadi kalau user
      // udah login di modul lain (Konversian, Produk), sesi kesini otomatis kebawa dari
      // storage key `pnm_auth_session` yang sama, tanpa perlu login ulang. ──
      const gateWrap = container.querySelector('#' + 'gateWrap');
      const appWrap = container.querySelector('#' + 'appWrap');
      const gateTitle = container.querySelector('#' + 'gateTitle');
      const gateDesc = container.querySelector('#' + 'gateDesc');
      const loginFormWrap = container.querySelector('#' + 'loginFormWrap');
      const loginEmail = container.querySelector('#' + 'loginEmail');
      const loginPassword = container.querySelector('#' + 'loginPassword');
      const loginBtn = container.querySelector('#' + 'loginBtn');
      const gateMsg = container.querySelector('#' + 'gateMsg');
  
      function showGateMsg(text, type){
          gateMsg.textContent = text;
          gateMsg.className = 'gate-msg show ' + type;
      }
  
      loginFormWrap.addEventListener('submit', async (e) => {
          e.preventDefault();
          const email = loginEmail.value.trim().toLowerCase();
          const password = loginPassword.value;
          if (!email || !email.includes('@')) { showGateMsg('Masukkan email yang valid dulu ya.', 'error'); return; }
          if (!password) { showGateMsg('Masukkan password.', 'error'); return; }
          loginBtn.disabled = true;
          loginBtn.textContent = 'Memproses...';
          try {
              await PNMAuth.login(email, password); // dulu: sb.auth.signInWithPassword langsung
          } catch (error) {
              showGateMsg('Gagal masuk: ' + error.message, 'error');
          }
          loginBtn.disabled = false;
          loginBtn.textContent = 'Masuk';
      });
  
      let alreadyShownForUserId = null; // guard: cegah checkWhitelistAndShowApp()/loadFileList() kepanggil dobel
                                         // kalau SDK nembak INITIAL_SESSION lalu SIGNED_IN buat sesi yang sama
  
      async function checkWhitelistAndShowApp(session){
          if (alreadyShownForUserId === session.user.id) return;
  
          const email = session.user.email.toLowerCase();
          const { data, error } = await sb.from('allowed_users').select('email').eq('email', email).maybeSingle();
          if (error) {
              showGateMsg('Gagal cek akses (koneksi bermasalah), coba lagi: ' + error.message, 'error');
              return;
          }
          if (!data) {
              await PNMAuth.logout(); // dulu: sb.auth.signOut() langsung
              gateTitle.textContent = 'Akses Ditolak';
              gateDesc.textContent = 'Email ' + email + ' belum terdaftar sebagai tim.';
              loginFormWrap.style.display = 'none';
              showGateMsg('Hubungi admin untuk ditambahkan ke daftar akses.', 'error');
              return;
          }
          alreadyShownForUserId = session.user.id;
          gateWrap.style.display = 'none';
          appWrap.style.display = 'flex';
          loadFileList();
      }
  
      const AUTH_EVENTS_YANG_MEMICU_GATE = new Set(['SIGNED_IN', 'INITIAL_SESSION']);
      authUnsubscribe = PNMAuth.onAuthStateChange((event, session) => { // dulu: sb.auth.onAuthStateChange langsung
          if (session && AUTH_EVENTS_YANG_MEMICU_GATE.has(event)) {
              checkWhitelistAndShowApp(session);
          } else if (!session) {
              alreadyShownForUserId = null;
              gateWrap.style.display = 'flex';
              appWrap.style.display = 'none';
              loginFormWrap.style.display = 'block';
              gateTitle.textContent = 'Masuk dulu ya';
              gateDesc.textContent = 'Khusus tim internal — pakai akun yang sama seperti Konversian/Produk.';
          }
      });
  
      // Input cepat: cocokkan tiap baris terhadap nama file (atau file ID) di daftar,
      // lalu pilih otomatis (maks 4).
      function applyBulkInput() {
          const raw = container.querySelector('#' + "bulkInput").value;
          const lines = [...new Set(raw.split("\n").map(s => s.trim()).filter(Boolean))];
  
          if (lines.length === 0) {
              toast("Masukkan kode terlebih dahulu, satu per baris.", "error");
              return;
          }
          if (lines.length > MAX_IMAGES) {
              toast(`Maksimal ${MAX_IMAGES} kode sekaligus. Kamu memasukkan ${lines.length}.`, "error");
              return;
          }
  
          const matchedIds = [];
          const notFound = [];
          // buang ekstensi file (.png, .jpg, dst) supaya kode tanpa ekstensi tetap cocok
          const stripExt = (s) => String(s).trim().toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, "");
  
          lines.forEach(line => {
              const target = stripExt(line);
              const found = allFiles.find(f => stripExt(f.id) === target);
              if (found) {
                  if (!matchedIds.includes(found.id)) matchedIds.push(found.id);
              } else {
                  notFound.push(line);
              }
          });
  
          if (matchedIds.length === 0) {
              toast("Tidak ada kode yang cocok dengan daftar file.", "error");
              return;
          }
  
          selectedIds.length = 0;
          matchedIds.forEach(id => selectedIds.push(id));
          renderFileList();
          renderChips();
  
          if (notFound.length > 0) {
              toast(`${matchedIds.length} cocok, ${notFound.length} tidak ditemukan: ${notFound.join(", ")}`, "error", 6000);
          } else {
              toast(`${matchedIds.length} gambar berhasil dipilih dari kode.`, "success", 2500);
          }
      }
  
      // Toast notification helper — feedback ke user, bukan cuma console
      function toast(message, type = "error", duration = 4000) {
          const root = container.querySelector('#' + "toastRoot");
          const el = document.createElement("div");
          el.className = `toast ${type}`;
          el.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${message}</span>`;
          root.appendChild(el);
          requestAnimationFrame(() => el.classList.add("in"));
          setTimeout(() => {
              el.classList.remove("in");
              setTimeout(() => el.remove(), 400);
          }, duration);
      }
  
      function setButtonLoading(btn, isLoading, loadingLabel) {
          if (isLoading) {
              btn.dataset.originalHtml = btn.innerHTML;
              btn.disabled = true;
              btn.innerHTML = `<span class="btn-text">${loadingLabel}</span><span class="btn-icon" aria-hidden="true"><span class="spinner"></span></span>`;
          } else {
              btn.disabled = false;
              if (btn.dataset.originalHtml) btn.innerHTML = btn.dataset.originalHtml;
          }
      }
  
      let allFiles = [];       // {id, name} — id & name sama-sama kode_asli (nama file tanpa ekstensi)
      const selectedIds = [];  // max 4
      const MAX_IMAGES = 4;
  
      // Nama file template ini sendiri juga hidup di bucket "thumbnails" yang sama,
      // jadi harus difilter supaya nggak nongol sebagai "produk" di daftar pilihan.
      const EXCLUDED_FILENAMES = new Set(["TEMPLATE_THUMBNAIL_ROBUST.png"]);
  
      async function loadFileList() {
          console.log("[INFO] Mengambil daftar file dari Supabase Storage...");
          const url = `${SUPABASE_URL}/storage/v1/object/list/${THUMBNAILS_BUCKET}`;
          try {
              // Ambil token fresh tiap request (bukan cached), sama kayak pola getFreshToken()
              // di konversian.js -- kalau tab lama di-background terus token expire, ini tetap benar.
              const session = await PNMAuth.getSession(); // dulu: sb.auth.getSession() langsung
              if (!session) { showGateMsg('Sesi habis, silakan masuk lagi.', 'error'); return; }
              let response = await fetch(url, {
                  method: "POST",
                  headers: {
                      "Content-Type": "application/json",
                      "apikey": window.PNM_SUPABASE_ANON_KEY,
                      "Authorization": `Bearer ${session.access_token}`,
                  },
                  // limit 1000 per page, paginasi via offset kalau bucket-nya makin gede
                  // prefix wajib diisi walau kosong (artinya: list semua file di root bucket)
                  body: JSON.stringify({ prefix: "", limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
              });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              let data = await response.json();
              console.log("[DATA] Data dari Supabase Storage:", data);
              if (!Array.isArray(data) || !data.length) {
                  toast("Daftar file kosong atau tidak ditemukan.", "error");
                  return;
              }
              allFiles = data
                  .filter(obj => obj.name && !EXCLUDED_FILENAMES.has(obj.name) && obj.id) // obj.id null = folder, bukan file
                  .map(obj => {
                      const kode = obj.name.replace(/\.[a-z0-9]{2,5}$/i, ""); // buang ekstensi buat display
                      return { id: kode, name: kode };
                  });
              renderFileList();
          } catch (error) {
              console.error("[ERROR] Gagal mengambil daftar file dari Supabase Storage!", error);
              toast("Gagal memuat daftar file. Coba muat ulang halaman.", "error");
          }
      }
  
      function renderFileList() {
          const query = container.querySelector('#' + "searchInput").value.toLowerCase();
          const listEl = container.querySelector('#' + "fileList");
          const filtered = allFiles.filter(f => f.name.toLowerCase().includes(query));
  
          if (filtered.length === 0) {
              listEl.innerHTML = `<div class="file-list-empty">Tidak ada hasil yang cocok.</div>`;
              return;
          }
  
          listEl.innerHTML = filtered.map(f => {
              const isSelected = selectedIds.includes(f.id);
              const isDisabled = !isSelected && selectedIds.length >= MAX_IMAGES;
              return `
                  <div class="file-item ${isSelected ? "selected" : ""} ${isDisabled ? "disabled" : ""}"
                       role="option" aria-selected="${isSelected}"
                       onclick="${isDisabled ? "" : `toggleFile('${f.id}')`}">
                      <span class="check" aria-hidden="true">${isSelected ? "✓" : ""}</span>
                      <span class="name">${f.name}</span>
                  </div>`;
          }).join("");
      }
  
      function toggleFile(id) {
          const idx = selectedIds.indexOf(id);
          if (idx > -1) {
              selectedIds.splice(idx, 1);
          } else {
              if (selectedIds.length >= MAX_IMAGES) {
                  toast(`Maksimal ${MAX_IMAGES} gambar per template.`, "error");
                  return;
              }
              selectedIds.push(id);
          }
          renderFileList();
          renderChips();
      }
  
      function renderChips() {
          const chipsEl = container.querySelector('#' + "selectedChips");
          chipsEl.innerHTML = selectedIds.map(id => {
              const file = allFiles.find(f => f.id === id);
              const name = file ? file.name : id;
              return `<span class="chip">${name}<button type="button" aria-label="Hapus ${name}" onclick="toggleFile('${id}')">✕</button></span>`;
          }).join("");
      }
      // Cache supaya gambar yang sama tidak difetch ulang ke Google
      const imageCache = {};
  
      function getSupabaseImageUrl(kode) {
          // Bucket "thumbnails" publik & gambar disimpan by kode_asli — URL-nya deterministik,
          // nggak perlu API call/API key sama sekali buat ambil gambar individual.
          return `${SUPABASE_URL}/storage/v1/object/public/${THUMBNAILS_BUCKET}/${encodeURIComponent(kode)}.png`;
      }
  
      // Load gambar dengan retry + exponential backoff, khusus menangani 429
      function loadImageWithRetry(src, maxRetries = 4, baseDelay = 800) {
          return new Promise(async (resolve, reject) => {
              for (let attempt = 0; attempt <= maxRetries; attempt++) {
                  try {
                      const img = await loadImage(src);
                      resolve(img);
                      return;
                  } catch (err) {
                      if (attempt === maxRetries) {
                          reject(err);
                          return;
                      }
                      const delay = baseDelay * Math.pow(2, attempt); // 800ms, 1.6s, 3.2s, 6.4s
                      console.warn(`[RETRY] Gagal load gambar (percobaan ${attempt + 1}/${maxRetries}), coba lagi dalam ${delay}ms:`, src);
                      await new Promise(r => setTimeout(r, delay));
                  }
              }
          });
      }
  
      // Ambil overlay (sudah diproses hapus background) dengan cache per fileId
      async function getOverlayCanvasCached(kode) {
          if (imageCache[kode]) {
              console.log("[CACHE] Pakai gambar overlay dari cache untuk:", kode);
              return imageCache[kode];
          }
          const overlaySrc = getSupabaseImageUrl(kode);
          const overlayImg = await loadImageWithRetry(overlaySrc);
          const processedOverlay = await removeBackgroundHighQuality(overlayImg);
          imageCache[kode] = processedOverlay;
          return processedOverlay;
      }
      async function removeBackgroundHighQuality(image) {
          let tempCanvas = document.createElement("canvas");
          let ctx = tempCanvas.getContext("2d");
          tempCanvas.width = image.width;
          tempCanvas.height = image.height;
          ctx.drawImage(image, 0, 0, image.width, image.height);
          let imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
          let pixels = imageData.data;
          let threshold = 240;
          for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] > threshold && pixels[i + 1] > threshold && pixels[i + 2] > threshold) {
                  pixels[i + 3] = 0;
              }
          }
          ctx.putImageData(imageData, 0, 0);
          return trimTransparentEdges(tempCanvas);
      }
  
      // Memotong ruang kosong/transparan di sekeliling objek, supaya saat di-fit ke sel
      // grid, objeknya mengisi ruang secara maksimal (bukan ikut ruang kosong di sekitarnya).
      function trimTransparentEdges(canvas) {
          const ctx = canvas.getContext("2d");
          const { width, height } = canvas;
          const data = ctx.getImageData(0, 0, width, height).data;
  
          let minX = width, minY = height, maxX = -1, maxY = -1;
          for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                  const alpha = data[(y * width + x) * 4 + 3];
                  if (alpha > 10) {
                      if (x < minX) minX = x;
                      if (x > maxX) maxX = x;
                      if (y < minY) minY = y;
                      if (y > maxY) maxY = y;
                  }
              }
          }
  
          // fallback: kalau semua transparan (gagal deteksi), kembalikan canvas asli
          if (maxX < minX || maxY < minY) return canvas;
  
          const trimmedW = maxX - minX + 1;
          const trimmedH = maxY - minY + 1;
          const trimmed = document.createElement("canvas");
          trimmed.width = trimmedW;
          trimmed.height = trimmedH;
          trimmed.getContext("2d").drawImage(canvas, minX, minY, trimmedW, trimmedH, 0, 0, trimmedW, trimmedH);
          return trimmed;
      }
      function loadImage(src) {
          return new Promise((resolve, reject) => {
          let img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => resolve(img);
          img.onerror = () => {
              console.error("[ERROR] Gagal memuat gambar:", src);
              reject(new Error("Gagal memuat gambar"));
          };
          img.src = src;
      });
      }
      // Menyusun 1–4 overlay dalam grid, DI DALAM kotak putih template (koordinat
      // diukur langsung dari template: x 16.6%–86.2%, y 22%–65.2% dari kanvas).
      // Zona ini tetap sama untuk semua jumlah gambar — hanya grid di dalamnya yang berubah.
      function drawMergedCanvas(templateImg, overlayCanvases) {
          let canvas = container.querySelector('#' + "finalCanvas");
          let ctx = canvas.getContext("2d");
          canvas.width = templateImg.width;
          canvas.height = templateImg.height;
          ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);
  
          const count = overlayCanvases.length;
  
          // Batas kotak putih pada template (hasil pengukuran piksel langsung).
          const BOX = { xStart: 0.1664, xEnd: 0.8620, yStart: 0.2199, yEnd: 0.6523 };
          const zoneX = canvas.width * BOX.xStart;
          const zoneY = canvas.height * BOX.yStart;
          const zoneWidth = canvas.width * (BOX.xEnd - BOX.xStart);
          const zoneHeight = canvas.height * (BOX.yEnd - BOX.yStart);
  
          // Selalu 1 baris sejajar (bukan grid 2x2) — sesuai contoh referensi
          const cols = count;
          const rows = 1;
          const padding = zoneWidth * 0.025; // jarak dari tepi kotak & antar gambar
          const cellW = (zoneWidth - padding * (cols + 1)) / cols;
          const cellH = (zoneHeight - padding * (rows + 1)) / rows;
  
          overlayCanvases.forEach((overlayCanvas, i) => {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const cellX = zoneX + padding + col * (cellW + padding);
              const cellY = zoneY + padding + row * (cellH + padding);
  
              // fit gambar di dalam sel sambil menjaga aspect ratio, lalu center-kan
              const ratio = Math.min(cellW / overlayCanvas.width, cellH / overlayCanvas.height);
              const drawW = overlayCanvas.width * ratio;
              const drawH = overlayCanvas.height * ratio;
              const drawX = cellX + (cellW - drawW) / 2;
              const drawY = cellY + (cellH - drawH) / 2;
  
              ctx.drawImage(overlayCanvas, drawX, drawY, drawW, drawH);
          });
      }
  
      // kode_asli tervalidasi longgar — cukup pastikan nggak kosong/aneh sebelum dipakai di URL
      function isValidFileId(id) {
          return typeof id === "string" && id.trim().length > 0;
      }
  
      let isMerging = false; // guard supaya tidak ada request bertumpuk
  
      async function mergeAndPreview() {
          if (isMerging) {
              console.warn("[SKIP] Proses merge sebelumnya masih berjalan, klik diabaikan.");
              return;
          }
          if (selectedIds.length === 0) {
              toast("Pilih minimal 1 gambar terlebih dahulu!", "error");
              return;
          }
          if (selectedIds.some(id => !isValidFileId(id))) {
              toast("Ada file ID yang tidak valid.", "error");
              return;
          }
          console.log("[INFO] File ID yang dipilih:", selectedIds);
  
          const btn = container.querySelector('#' + "previewBtn");
          isMerging = true;
          setButtonLoading(btn, true, "Memproses...");
  
          try {
              console.log("[INFO] Mengambil gambar template & overlay...");
  
              const templateImg = imageCache[TEMPLATE_URL]
                  ? imageCache[TEMPLATE_URL]
                  : await (async () => {
                      const img = await loadImageWithRetry(TEMPLATE_URL);
                      imageCache[TEMPLATE_URL] = img;
                      return img;
                  })();
  
              // ambil semua overlay secara paralel, masing-masing pakai cache + retry sendiri
              let processedOverlays = await Promise.all(
                  selectedIds.map(id => getOverlayCanvasCached(id))
              );
  
              console.log("[SUCCESS] Gambar berhasil diproses.");
              drawMergedCanvas(templateImg, processedOverlays);
              container.querySelector('#' + "metaCount").textContent = String(selectedIds.length);
              container.querySelector('#' + "previewContainer").style.display = "block";
              container.querySelector('#' + "exportBtn").style.display = "inline-flex";
              requestAnimationFrame(() => {
                  container.querySelector('#' + "previewContainer").classList.add("in-view");
              });
              toast("Preview berhasil dibuat.", "success", 2500);
          } catch (error) {
              console.error("[ERROR] Gagal memproses gambar:", error);
              toast("Gagal memproses gambar. Pastikan file dapat diakses publik, atau coba lagi (rate-limit).", "error");
          } finally {
              isMerging = false;
              setButtonLoading(btn, false);
          }
      }
      // loadFileList() sekarang dipanggil dari checkWhitelistAndShowApp() setelah auth gate
      // lolos, bukan langsung di window.onload -- biar gak nembak Storage API sebelum ada
      // sesi/token yang valid.
  
      function exportCanvasAsPNG() {
          let canvas = container.querySelector('#' + "finalCanvas");
          let link = document.createElement("a");
          link.download = "combined-image.png";
          link.href = canvas.toDataURL("image/png");
          link.click();
          toast("Gambar berhasil diunduh.", "success", 2500);
      }
  
      // Scroll / entry reveal for bezel modules
      activeObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
              if (entry.isIntersecting) entry.target.classList.add("in-view");
          });
      }, { threshold: 0.15 });
      container.querySelectorAll(".bezel").forEach(el => activeObserver.observe(el));

  // Inline onclick/oninput attributes in the markup (applyBulkInput(),
  // renderFileList(), mergeAndPreview(), exportCanvasAsPNG(), toggleFile(id))
  // look these up on `window` regardless of this module's own scope, so they
  // have to be exposed explicitly here and cleaned up in unmount().
  window.applyBulkInput = applyBulkInput;
  window.renderFileList = renderFileList;
  window.mergeAndPreview = mergeAndPreview;
  window.exportCanvasAsPNG = exportCanvasAsPNG;
  window.toggleFile = toggleFile;
}

export function unmount() {
  activeObserver?.disconnect();
  activeObserver = null;
  authUnsubscribe?.();
  authUnsubscribe = null;
  delete window.applyBulkInput;
  delete window.renderFileList;
  delete window.mergeAndPreview;
  delete window.exportCanvasAsPNG;
  delete window.toggleFile;
  mountedContainer = null;
}
