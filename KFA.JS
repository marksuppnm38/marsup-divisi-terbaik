// ==UserScript==
// @name         KFA Alkes Automation - Pionir Group
// @namespace    pionir-marsup
// @version      1.10
// @description  Bantu automasi masukin SKU ke cangkang + validasi KFA di kamus-alkes.kemkes.go.id
// @match        https://kamus-alkes.kemkes.go.id/*
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  // ============================================================
  // CARA PAKAI (baca dulu sebelum jalanin ke banyak SKU):
  // 1. Login manual seperti biasa ke kamus-alkes.kemkes.go.id
  // 2. Panel kecil bakal muncul di pojok kanan atas
  // 3. Paste data antrian di textarea, format TAB-separated:
  //      KODE_PRODUK <TAB> NIE <TAB> TKDN <TAB> BRAND
  //    (satu baris = satu SKU, cangkang-nya ditentuin manual per halaman
  //     yang lagi kamu buka -- script ini TIDAK pindah-pindah cangkang
  //     sendiri, karena assignment cangkang tetap keputusan kamu)
  // 4. WAJIB test 1 item dulu manual sebelum lanjut ke banyak SKU sekaligus,
  //    karena hasilnya masuk ke sistem KFA nasional -- kalau ada yang aneh,
  //    berhenti dan cek manual, jangan lanjut ke SKU berikutnya.
  // 5. Tombol "Validate" & "Save" TIDAK di-klik otomatis secara default,
  //    supaya kamu tetap review sebelum commit. Bisa diaktifkan di panel
  //    kalau kamu sudah yakin alurnya stabil.
  // 6. Kalau field autocomplete tertentu susah dibuka via script (mis. baris
  //    Tipe/Type yang widget-nya berat/reaktif), buka field itu MANUAL dulu
  //    (klik biasa pakai mouse sampai kotak inputnya beneran muncul), lalu
  //    isi kode SKU di kotak "Isi field yang lagi kebuka" di panel dan
  //    tekan Alt+Enter (lihat catatan di dalam kode) -- script cuma akan
  //    ngetikin & milih dari autocomplete-nya, bagian buka field tetap manual.
  // 7. PENTING buat Proses B: field "Type" di modal wizard cuma bisa milih
  //    kode yang UDAH TERDAFTAR sebagai value "Tipe (Type)" di sistem.
  //    Pastikan Proses A buat SKU itu udah SELESAI DAN KE-SAVE (bukan cuma
  //    keliatan di layar) sebelum jalanin Proses B buat SKU yang sama.
  //    Kalau nggak, wizard-nya bisa gagal isi Brand/Type -- script sekarang
  //    akan BERHENTI otomatis kalau itu kejadian (nggak lanjut klik Next),
  //    tapi tetap cek manual ke daftar produk buat mastiin nggak ada
  //    produk duplikat/kosong yang keburu kebuat sebelum fix ini dipasang.
  // 8. Kalau kamu MATIIN "Auto-klik Validate" (biar sempat cek manual dulu),
  //    setelah klik "Proses B" script bakal berhenti sebelum Validate dan
  //    NUNGGUIN kamu klik Validate manual sendiri. Begitu kamu klik Validate
  //    manual, script otomatis lanjut ambil kode KFA, Save (kalau auto-save
  //    dicentang), catat hasil, dan geser antrian.
  // 9. Proses B otomatis DETEKSI tombolnya: "Configure Product" (SKU
  //    pertama di cangkang ini) atau "Reconfigure Product" (cangkang ini
  //    udah pernah dikonfigurasi buat SKU lain -- modal langsung ke
  //    Brand/Type tanpa step pilih template). Script nyesuain sendiri.
  // 10. Centang "Auto-lanjut ke SKU berikutnya" kalau mau abis 1 SKU
  //     berhasil (dapet kode KFA valid), script LANGSUNG proses SKU
  //     berikutnya di antrian sendiri tanpa kamu klik apa-apa lagi. Kalau
  //     ada SKU yang GAGAL di tengah jalan, auto-lanjut ini BERHENTI
  //     otomatis (nggak maksa lanjut ke SKU berikutnya), biar kamu sempat
  //     cek manual dulu.
  // 11. Buat mindahin hasil ke Google Sheets: klik "Copy Hasil (TSV)" di
  //     panel -- ini nyalin daftar hasil (KODE_PRODUK, KODE_KFA, TIMESTAMP)
  //     ke clipboard dalam format tab-separated. Tinggal buka Sheets, klik
  //     cell kosong, Ctrl+V / Cmd+V -- otomatis kepecah per kolom & per
  //     baris kayak paste dari Excel. Kalau browser nolak akses clipboard
  //     otomatis, textarea "Preview hasil" di bawah tombol bakal muncul --
  //     select-all manual (klik textarea-nya, Ctrl+A, Ctrl+C) dari situ.
  //
  // v1.3: Fix dropdown Brand di-portal keluar .modal (dicari via jarak ke
  //       input, isNearInput, bukan ancestry .modal).
  // v1.3.1: Fix Next kedua diklik sebelum enabled + nunggu modal beneran
  //       hilang sebelum lanjut cari tab.
  // v1.4: Fix kode KFA "/" ketangkep sebagai sukses -- sekarang wajib bukan
  //       placeholder kosong (isValidKfaCode) + watcher buat Validate manual.
  // v1.5: Fix Validate ketabrak tab Informasi Farmalkes (nunggu tombol
  //       Validate ilang dulu, bukan sleep tebakan) + dukungan tombol
  //       "Reconfigure Product".
  // v1.6: Tambah opsi "Auto-lanjut ke SKU berikutnya" -- abis 1 SKU sukses,
  //       otomatis proses SKU berikutnya di antrian sendiri (berhenti kalau
  //       ada yang gagal). Berlaku baik di jalur auto-validate maupun jalur
  //       Validate manual (watcher).
  // v1.7: Fix clickByText bisa nge-klik elemen "Validate" (atau tombol lain)
  //       yang SAMA TEKSNYA tapi lagi tersembunyi/disabled di DOM (umum di
  //       Odoo -- ada elemen duplikat state lain). Sekarang clickByText bisa
  //       difilter visibleOnly, dan alur Validate nunggu tombolnya beneran
  //       visible dulu (bukan asumsi siap begitu Get NIE selesai) sebelum
  //       diklik. Tombol Edit/Save/Get NIE/Configure-Reconfigure Product
  //       juga dipaksa visibleOnly biar nggak salah klik elemen tersembunyi.
  // v1.8: Fix lanjutan -- tombol Validate bisa KELIHATAN tapi masih
  //       DISABLED sesaat (nunggu field lain/hasil fetch Regalkes beres).
  //       Sekarang nunggu sampai tombolnya visible DAN enabled (bukan cuma
  //       visible) sebelum diklik. Kalau tetap disabled setelah 10 detik,
  //       script berhenti & print detail elemen + field yang invalid ke
  //       console (F12) biar gampang didiagnosis penyebabnya.
  // v1.9: Fix BESAR -- checkbox "Auto validate/Auto save/Auto-lanjut" balik
  //       ke UNCHECKED tiap kali panel digambar ulang (renderPanel() jalan
  //       berkali-kali di tengah proses: abis Save, abis geser antrian,
  //       dst), sehingga auto-lanjut berhenti diam-diam padahal user udah
  //       nyentang semuanya. Sekarang status ketiga checkbox disimpan di
  //       variabel terpisah (autoFlags) yang nggak ke-reset waktu panel
  //       digambar ulang, dan checkbox-nya sync dua arah ke variabel itu.
  // v1.10: Tambah opsi export hasil sebagai TEKS PASTEABLE (tab-separated)
  //       yang bisa langsung di-paste ke Google Sheets, sebagai alternatif
  //       download CSV. Tombol baru "Copy Hasil (TSV)" nyalin ke clipboard
  //       otomatis (navigator.clipboard, dengan fallback execCommand kalau
  //       clipboard API diblokir), plus textarea "Preview hasil" yang bisa
  //       di-select manual & Ctrl+C kalau copy otomatis gagal.
  // ============================================================
  const STORAGE_KEY = 'kfa_automation_queue_v1';
  const RESULTS_KEY = 'kfa_automation_results_v1';
  // ---------- Helpers ----------
  function log(msg) {
    const box = document.getElementById('kfa-log');
    if (box) {
      const line = document.createElement('div');
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      box.prepend(line);
    }
    console.log('[KFA-AUTO]', msg);
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function waitFor(checkFn, { timeout = 8000, interval = 150 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const timer = setInterval(() => {
        const result = checkFn();
        if (result) {
          clearInterval(timer);
          resolve(result);
        } else if (Date.now() - start > timeout) {
          clearInterval(timer);
          reject(new Error('waitFor timeout: ' + checkFn.toString().slice(0, 80)));
        }
      }, interval);
    });
  }
  function isValidKfaCode(text) {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
    if (t === '/' || t === '-' || t === '—') return false;
    return true;
  }
  function hasVisibleValidateButton() {
    const spans = Array.from(document.querySelectorAll('span'));
    return spans.some((el) => el.textContent.trim() === 'Validate' && isVisible(el));
  }
  // v1.8: cari elemen tombol Validate (bukan cuma span-nya) supaya bisa
  // dicek statusnya "disabled" beneran, bukan cuma "kelihatan".
  function getVisibleValidateButtonEl() {
    const spans = Array.from(document.querySelectorAll('span'));
    const match = spans.find((el) => el.textContent.trim() === 'Validate' && isVisible(el));
    if (!match) return null;
    return match.closest('button') || match;
  }
  function isBtnDisabled(el) {
    return !!(el.disabled || el.classList?.contains('disabled') || el.classList?.contains('o_disabled')
      || el.getAttribute?.('aria-disabled') === 'true');
  }
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // v1.7: tambah opsi { visibleOnly } supaya kita nggak salah klik elemen
  // ber-teks sama yang lagi disembunyiin/disabled di DOM (umum di Odoo).
  function clickByText(selector, text, { visibleOnly = false } = {}) {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    const target = norm(text);
    let els = Array.from(document.querySelectorAll(selector));
    if (visibleOnly) {
      els = els.filter((el) => isVisible(el.closest('button') || el));
    }
    let match = els.find((el) => norm(el.textContent) === target);
    if (!match) {
      match = els.find((el) => norm(el.textContent).includes(target));
    }
    if (!match) return false;
    const clickTarget = match.closest('button') || match;
    if (clickTarget.disabled || clickTarget.classList?.contains('disabled')) return false;
    clickTarget.click();
    return true;
  }
  function collectCandidateMenus(root = document) {
    const selectors = [
      '.ui-autocomplete',
      '.ui-autocomplete-menu',
      '.o-autocomplete--dropdown-menu',
      '.o_input_dropdown_container .dropdown-menu',
      '.dropdown-menu',
      '[role="listbox"]',
      '[role="menu"]',
    ];
    return new Set(root.querySelectorAll(selectors.join(',')));
  }
  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isNearInput(el, inputEl, maxDist = 400) {
    const r = el.getBoundingClientRect();
    const ir = inputEl.getBoundingClientRect();
    const vGap = Math.min(Math.abs(r.top - ir.bottom), Math.abs(ir.top - r.bottom));
    return vGap < maxDist;
  }
  async function fillAutocomplete(inputEl, text) {
    inputEl.focus();
    const before = collectCandidateMenus(document);
    setNativeValue(inputEl, text);
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: text.slice(-1) }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text.slice(-1) }));
    let menu = await waitFor(() => {
      const m = document.querySelector('.ui-autocomplete:not([style*="display: none"]), .ui-autocomplete-menu:not([style*="display: none"])');
      return m && m.querySelectorAll('li').length && isNearInput(m, inputEl) ? m : null;
    }, { timeout: 3000 }).catch(() => null);
    if (!menu) {
      menu = await waitFor(() => {
        const now = collectCandidateMenus(document);
        for (const el of now) {
          if (!before.has(el) && isVisible(el) && isNearInput(el, inputEl)
              && el.querySelectorAll('li, [role="option"], .dropdown-item').length) {
            return el;
          }
        }
        return null;
      }, { timeout: 4000 }).catch(() => null);
    }
    if (!menu) {
      log(`⚠️ Autocomplete nggak muncul buat "${text}" -- cek manual.`);
      const candidates = Array.from(collectCandidateMenus(document));
      console.log('[KFA-AUTO] Nggak nemu menu autocomplete. Kandidat elemen dropdown di document:');
      candidates.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        console.log(`[KFA-AUTO] Candidate ${i}: rect=`, r, 'visible=', isVisible(el), el.outerHTML.slice(0, 300));
      });
      console.log('[KFA-AUTO] Input yang lagi diisi:', inputEl, '| value sekarang:', inputEl.value, '| rect:', inputEl.getBoundingClientRect());
      return false;
    }
    const items = Array.from(menu.querySelectorAll('li, [role="option"], .dropdown-item'));
    const exact = items.find((li) => li.textContent.trim() === text);
    const target = exact || items[0];
    if (!target) return false;
    (target.querySelector('a') || target).click();
    return true;
  }
  let lastFocusedInput = null;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (
      el && el.tagName === 'INPUT' && el.type === 'text' &&
      !el.disabled && !el.readOnly &&
      !el.closest('#kfa-panel')
    ) {
      lastFocusedInput = el;
    }
  }, true);
  function loadQueue() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveQueue(q) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  }
  function loadResults() {
    try {
      return JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function saveResults(r) {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(r));
  }
  // ============================================================
  // PROSES A
  // ============================================================
  async function runProsesA(kodeProduk) {
    log(`Proses A: masukin "${kodeProduk}" ke cangkang...`);
    if (!clickByText('button', 'Edit', { visibleOnly: true })) {
      log('⚠️ Tombol Edit nggak ketemu. Pastikan kamu di halaman cangkang (tab Variants) dulu.');
      return false;
    }
    await sleep(600);
    document.activeElement?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.click();
    await sleep(300);
    const attributeTable = await waitFor(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      return (
        tables.find((table) => {
          const headerText = table.querySelector('thead')?.textContent.toLowerCase()
            || table.rows[0]?.textContent.toLowerCase()
            || '';
          return headerText.includes('attribute') && headerText.includes('value');
        }) || null
      );
    }).catch(() => null);
    if (!attributeTable) {
      log('⚠️ Tabel attribute (Attribute/Required/Values) nggak ketemu -- pastikan kamu di tab Variants.');
      return false;
    }
    const attributeRow = Array.from(attributeTable.querySelectorAll('tbody tr, tr')).find((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      return cells.some((cell) => {
        const text = cell.textContent.trim().toLowerCase();
        return text.startsWith('tipe') || text.startsWith('type');
      });
    });
    if (!attributeRow) {
      log('⚠️ Baris attribute "Tipe (Type)" nggak ketemu di dalam tabel Variants. Daftar label baris yang ke-scan saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan.');
      const allRows = Array.from(attributeTable.querySelectorAll('tbody tr, tr'));
      console.log('[KFA-AUTO] Tabel attribute ketemu, tapi baris "Tipe" nggak match. Ini daftar semua baris & seluruh isi cell-nya:');
      allRows.forEach((tr, i) => {
        const cellsText = Array.from(tr.querySelectorAll('td')).map((c) => c.textContent.trim());
        console.log(`[KFA-AUTO] Row ${i}: cells=${JSON.stringify(cellsText)}`);
      });
      return false;
    }
    const tagsField = attributeRow.querySelector('.o_field_many2manytags, .o_field_widget[name="value_ids"]');
    if (!tagsField) {
      log('⚠️ Field tags di baris "Tipe (Type)" nggak ketemu. Struktur HTML baris ini saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan selectornya.');
      console.log('[KFA-AUTO] HTML baris "Tipe (Type)" yang ketemu:');
      console.log(attributeRow.outerHTML);
      return false;
    }
    const existingTags = tagsField.querySelectorAll('.o_tag, .badge, .o_field_tags .o_tag_badge_text');
    const lastTag = existingTags[existingTags.length - 1];
    if (lastTag) {
      lastTag.scrollIntoView({ block: 'center' });
    } else {
      tagsField.scrollIntoView({ block: 'center' });
    }
    await sleep(200);
    document.activeElement?.blur();
    tagsField.click();
    await sleep(300);
    const input = await waitFor(() =>
      tagsField.querySelector('input.ui-autocomplete-input, input[type="text"]')
    ).catch(() => null);
    if (!input) {
      log('⚠️ Input buat nambah tag di baris "Tipe (Type)" nggak muncul setelah klik field. Coba klik manual dulu di area kosong setelah tag terakhir buat mancing inputnya (lalu pakai tombol "Isi field yang lagi kebuka" di bawah), atau cek apakah field-nya readonly.');
      return false;
    }
    const ok = await fillAutocomplete(input, kodeProduk);
    if (!ok) {
      log(`⚠️ "${kodeProduk}" nggak ketemu di autocomplete tag "Tipe (Type)" -- kemungkinan kode belum terdaftar di sistem KFA sama sekali. Cek manual.`);
      return false;
    }
    await sleep(500);
    log(`✅ "${kodeProduk}" berhasil ditambah ke daftar tag "Tipe (Type)". Klik Save manual untuk commit, atau centang auto-save di panel.`);
    if (autoFlags.autosave) {
      clickByText('button', 'Save', { visibleOnly: true });
      log('💾 Save di-klik otomatis.');
    }
    return true;
  }
  // ============================================================
  // BANTUAN: isi field autocomplete yang lagi FOKUS, lewat hotkey
  // ============================================================
  document.addEventListener('keydown', async (e) => {
    const isHotkey = e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    if (!isHotkey) return;
    const active = document.activeElement;
    const isValidField = active && active.tagName === 'INPUT' && active.type === 'text'
      && !active.disabled && !active.readOnly && !active.closest('#kfa-panel');
    if (!isValidField) return;
    e.preventDefault();
    e.stopPropagation();
    const kodeProduk = document.getElementById('kfa-assist-input')?.value.trim();
    if (!kodeProduk) {
      log('⚠️ Isi dulu kode SKU di kotak "Isi field yang lagi kebuka" di panel sebelum pakai Alt+Enter.');
      return;
    }
    log(`(Alt+Enter) Ketik & pilih "${kodeProduk}" di field yang lagi fokus...`);
    const ok = await fillAutocomplete(active, kodeProduk);
    if (ok) {
      log(`✅ "${kodeProduk}" berhasil dipilih via Alt+Enter.`);
      if (autoFlags.autosave) {
        await sleep(300);
        if (clickByText('button', 'Save', { visibleOnly: true })) {
          log('💾 Save di-klik otomatis.');
        } else {
          log('⚠️ Auto-save aktif tapi tombol Save nggak ketemu -- save manual ya.');
        }
      }
      const q = loadQueue();
      if (q.length && q[0].kodeProduk === kodeProduk) {
        q.shift();
        saveQueue(q);
        log(`➡️ Antrian digeser. Sisa: ${q.length} SKU.`);
        renderPanel();
      }
    } else {
      log(`⚠️ "${kodeProduk}" nggak ketemu di autocomplete field ini. Cek manual.`);
    }
  }, true);
  async function fillCurrentlyOpenField(kodeProduk) {
    const input = lastFocusedInput;
    if (!input || !input.isConnected) {
      log('⚠️ Belum kedetect ada field yang lagi kebuka. Klik dulu manual ke field yang mau diisi (sampai kotak input-nya beneran muncul & fokus), baru klik tombol ini lagi.');
      return false;
    }
    const rect = input.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      log('⚠️ Field terakhir yang kedetect udah nggak kelihatan (mungkin halaman/tab udah pindah). Klik ulang manual ke field yang mau diisi.');
      return false;
    }
    if (input.disabled || input.readOnly) {
      log('⚠️ Field yang kedetect ternyata disabled/readonly -- ini bukan kotak input yang aktif buat nambah tag, kemungkinan cuma elemen tampilan yang kebetulan ke-fokus. Coba klik lagi PERSIS di celah kosong setelah tag/chip terakhir (biasanya ada kursor kedip-kedip di situ kalau bener), baru klik tombol ini lagi.');
      return false;
    }
    log(`Ketik & pilih "${kodeProduk}" di field yang barusan kamu klik manual...`);
    const ok = await fillAutocomplete(input, kodeProduk);
    if (!ok) {
      log(`⚠️ "${kodeProduk}" nggak ketemu di autocomplete field ini -- cek apakah field yang kedetect emang field yang dimaksud, atau kode belum terdaftar. Cek manual.`);
      return false;
    }
    log(`✅ "${kodeProduk}" berhasil dipilih di field yang dibuka manual.`);
    return true;
  }
  // ============================================================
  // PROSES B
  // ============================================================
  async function runProsesB({ kodeProduk, brand, nie, tkdn }) {
    log(`Proses B: konfigurasi produk "${kodeProduk}"...`);
    let usingReconfigure = false;
    if (clickByText('span', 'Configure Product', { visibleOnly: true })) {
      usingReconfigure = false;
    } else if (clickByText('span', 'Reconfigure Product', { visibleOnly: true })) {
      usingReconfigure = true;
      log('i️ Pakai "Reconfigure Product" (cangkang ini udah pernah dikonfigurasi sebelumnya).');
    } else {
      log('⚠️ Tombol "Configure Product" / "Reconfigure Product" nggak ketemu.');
      return null;
    }
    await sleep(700);
    if (!usingReconfigure) {
      const nextBtn1 = await waitFor(() =>
        document.querySelector('button[name="action_next_step"]')
      ).catch(() => null);
      if (!nextBtn1) {
        log('⚠️ Tombol Next pertama nggak ketemu di modal.');
        return null;
      }
      nextBtn1.click();
      await sleep(700);
    }
    const modalInputs = await waitFor(() => {
      const inputs = document.querySelectorAll('.modal .o_input.ui-autocomplete-input');
      return inputs.length >= 2 ? inputs : null;
    }).catch(() => null);
    if (!modalInputs) {
      log('⚠️ Input Brand/Type nggak ketemu di modal.');
      return null;
    }
    if (brand) {
      const brandOk = await fillAutocomplete(modalInputs[0], brand);
      if (!brandOk) {
        log(`⚠️ Brand "${brand}" nggak ketemu/gagal dipilih di modal -- BERHENTI di sini, TIDAK lanjut klik Next, biar nggak kebuat produk dengan Brand kosong. Cek manual, atau pastikan brand ini valid.`);
        return null;
      }
      await sleep(400);
    }
    const typeOk = await fillAutocomplete(modalInputs[1], kodeProduk);
    if (!typeOk) {
      log(`⚠️ Type "${kodeProduk}" nggak ketemu/gagal dipilih di modal -- BERHENTI di sini, TIDAK lanjut klik Next, biar nggak kebuat produk dengan Type kosong. Kemungkinan kode ini belum ke-save sebagai value "Tipe (Type)" (jalanin & Save Proses A dulu buat SKU ini), atau cek manual.`);
      return null;
    }
    await sleep(400);
    const nextBtn2 = await waitFor(() => {
      const btn = document.querySelector('button[name="action_next_step"]');
      return btn && !btn.disabled && !btn.classList.contains('disabled') ? btn : null;
    }, { timeout: 5000 }).catch(() => null);
    if (!nextBtn2) {
      log('⚠️ Tombol Next kedua nggak ketemu / nggak pernah aktif (mungkin masih nunggu validasi field Brand/Type). Cek manual.');
      return null;
    }
    const modalBeforeNext2 = nextBtn2.closest('.modal');
    nextBtn2.click();
    const modalGone = await waitFor(() => {
      return !modalBeforeNext2 || !modalBeforeNext2.isConnected;
    }, { timeout: 6000 }).catch(() => false);
    if (!modalGone) {
      log(`⚠️ Modal wizard kelihatannya masih kebuka setelah Next kedua diklik (mungkin ada validasi yang gagal diam-diam). URL saat ini: ${location.href}. Cek manual, jangan lanjut otomatis.`);
      return null;
    }
    await sleep(800);
    let tabFound = clickByText('a', 'Program dan Kemandirian', { visibleOnly: true });
    if (!tabFound) {
      const fallbackTab = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]'))
        .find((a) => a.textContent.toLowerCase().includes('kemandirian') && isVisible(a));
      if (fallbackTab) {
        fallbackTab.click();
        tabFound = true;
      }
    }
    if (!tabFound) {
      log(`⚠️ Tab "Program dan Kemandirian" nggak ketemu. URL saat ini: ${location.href}. Daftar tab yang ke-scan saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan.`);
      const navLinks = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]'));
      console.log('[KFA-AUTO] Daftar tab (a.nav-link / a[data-toggle="tab"]) yang ke-scan:');
      navLinks.forEach((a, i) => console.log(`[KFA-AUTO] Tab ${i}: text="${a.textContent.trim()}" href="${a.getAttribute('href')}" visible=${isVisible(a)}`, a));
      return null;
    }
    await sleep(400);
    if (!clickByText('button', 'Edit', { visibleOnly: true })) {
      log('⚠️ Tombol Edit di halaman variant nggak ketemu.');
      return null;
    }
    await sleep(500);
    const nieInput = await waitFor(() => document.querySelector('input[name="nie"]')).catch(() => null);
    const tkdnInput = document.querySelector('input[name="score_tkdn"]');
    if (!nieInput || !tkdnInput) {
      log('⚠️ Field NIE/TKDN nggak ketemu.');
      return null;
    }
    setNativeValue(nieInput, nie);
    if (tkdn !== undefined && tkdn !== '') {
      setNativeValue(tkdnInput, String(tkdn));
    }
    await sleep(300);
    if (!clickByText('span', 'Get NIE REGALKES', { visibleOnly: true })) {
      log('⚠️ Tombol "Get NIE REGALKES" nggak ketemu.');
      return null;
    }
    log('⏳ Nunggu data Regalkes ke-fetch...');
    await sleep(2500);
    // v1.7: jangan asumsi tombol Validate udah siap begitu sleep 2.5 detik
    // lewat -- tunggu betulan sampai tombol Validate KELIHATAN, biar
    // klik-nya nggak nyasar ke elemen "Validate" lain yang tersembunyi.
    log('⏳ Nunggu tombol Validate beneran siap/kelihatan...');
    const validateReady = await waitFor(() => hasVisibleValidateButton(), { timeout: 10000, interval: 300 }).catch(() => false);
    if (!validateReady) {
      log('⚠️ Tombol Validate nggak pernah kelihatan setelah Get NIE REGALKES (ditunggu 10 detik). Kemungkinan fetch Regalkes gagal/lambat, atau NIE-nya nggak valid. Cek manual, JANGAN dianggap sukses.');
      return null;
    }
    if (!autoFlags.autovalidate) {
      log('⏸️ Berhenti sebelum Validate -- centang "Auto validate" di panel kalau mau lanjut otomatis, atau klik Validate manual sekarang (script bakal otomatis nungguin & nglanjutin abis kamu Validate).');
      return 'PAUSED_BEFORE_VALIDATE';
    }
    // v1.8: tombol udah KELIHATAN belum tentu udah BISA DIKLIK -- Odoo
    // sering nampilin tombol lebih dulu, baru enable-nya nyusul setelah
    // field lain (mis. TKDN) atau hasil fetch Regalkes selesai divalidasi.
    // Tunggu sampai visible DAN nggak disabled, baru klik langsung ke
    // elemen tombolnya.
    log('⏳ Mastiin tombol Validate enabled (nggak abu-abu)...');
    const validateBtn = await waitFor(() => {
      const btn = getVisibleValidateButtonEl();
      return btn && !isBtnDisabled(btn) ? btn : null;
    }, { timeout: 10000, interval: 300 }).catch(() => null);
    if (!validateBtn) {
      const stuckBtn = getVisibleValidateButtonEl();
      log('⚠️ Tombol Validate kelihatan tapi TETAP disabled setelah ditunggu 10 detik -- kemungkinan ada field wajib lain yang belum valid (cek TKDN/NIE atau field lain di tab ini). Detail elemen saya print ke console (F12), dan field yang ke-mark invalid oleh Odoo (kalau ada) juga saya list. Cek manual, JANGAN dianggap sukses.');
      if (stuckBtn) {
        console.log('[KFA-AUTO] Elemen tombol Validate yang macet (disabled):', stuckBtn, stuckBtn.outerHTML.slice(0, 400));
      }
      const invalidFields = Array.from(document.querySelectorAll('.o_field_invalid, .is-invalid'));
      if (invalidFields.length) {
        console.log('[KFA-AUTO] Field yang ke-mark invalid oleh Odoo saat ini:');
        invalidFields.forEach((f, i) => console.log(`[KFA-AUTO] Invalid field ${i}:`, f, f.outerHTML.slice(0, 200)));
      } else {
        console.log('[KFA-AUTO] Nggak ada field ber-class o_field_invalid/is-invalid yang kedetect -- kemungkinan penyebab disabled-nya bukan validasi field biasa (mis. masih nunggu request Regalkes, atau state Odoo lain). Cek tab ini manual.');
      }
      return null;
    }
    validateBtn.click();
    log('⏳ Nunggu proses validasi selesai (nungguin tombol Validate ilang/berubah)...');
    const validateDone = await waitFor(() => !hasVisibleValidateButton(), { timeout: 15000, interval: 400 }).catch(() => false);
    if (!validateDone) {
      log('⚠️ Tombol Validate masih kelihatan setelah ditunggu 15 detik -- kemungkinan validasi gagal/nyangkut. Cek manual, JANGAN dianggap sukses.');
      return null;
    }
    await sleep(500);
    if (!clickByText('a', 'Informasi Farmalkes', { visibleOnly: true })) {
      log('⚠️ Tab "Informasi Farmalkes" nggak ketemu. Daftar tab yang ke-scan saya print ke console (F12) -- copy-paste hasilnya biar bisa saya sesuaikan.');
      const navLinks = Array.from(document.querySelectorAll('a.nav-link, a[data-toggle="tab"]'));
      console.log('[KFA-AUTO] Daftar tab (a.nav-link / a[data-toggle="tab"]) yang ke-scan:');
      navLinks.forEach((a, i) => console.log(`[KFA-AUTO] Tab ${i}: text="${a.textContent.trim()}" href="${a.getAttribute('href')}" visible=${isVisible(a)}`, a));
      return null;
    }
    await sleep(500);
    const kfaCode = await waitFor(() => {
      const el = document.querySelector('span[name="kfa_pa_code"]');
      const text = el?.textContent.trim();
      return isValidKfaCode(text) ? text : null;
    }, { timeout: 15000, interval: 400 }).catch(() => null);
    if (!kfaCode) {
      log('⚠️ Kode KFA (PA) belum muncul (masih kosong/placeholder "/" setelah ditunggu) -- kemungkinan validasi gagal atau butuh waktu lebih lama. Cek manual, JANGAN dianggap sukses.');
      return null;
    }
    log(`🎉 Kode KFA (PA) buat "${kodeProduk}": ${kfaCode}`);
    if (autoFlags.autosave) {
      clickByText('button', 'Save', { visibleOnly: true });
      log('💾 Save akhir di-klik otomatis.');
    } else {
      log('⏸️ Klik Save manual untuk commit hasil ini.');
    }
    const results = loadResults();
    results.push({ kodeProduk, kfaCode, timestamp: new Date().toISOString() });
    saveResults(results);
    renderPanel();
    return kfaCode;
  }
  // ============================================================
  // WATCHER: dipakai kalau auto-validate DIMATIKAN (validate manual).
  // Sekarang RETURN true/false biar caller (processNextInQueue) tau
  // apakah boleh lanjut ke auto-next atau harus berhenti.
  // ============================================================
  async function watchForManualValidateAndFinish(item) {
    log(`👀 Nunggu kamu klik Validate manual buat "${item.kodeProduk}"...`);
    const validated = await waitFor(() => {
      return !hasVisibleValidateButton() ? true : null;
    }, { timeout: 300000, interval: 1000 }).catch(() => false);
    if (!validated) {
      log(`⚠️ Nunggu Validate buat "${item.kodeProduk}" kelamaan (5 menit) / nggak terdeteksi selesai. Antrian TIDAK digeser otomatis -- cek manual, lanjutin sendiri kalau perlu.`);
      return false;
    }
    log('✅ Validate kedetect selesai. Buka tab "Informasi Farmalkes" & nungguin kode KFA...');
    await sleep(800);
    if (!clickByText('a', 'Informasi Farmalkes', { visibleOnly: true })) {
      log('⚠️ Tab "Informasi Farmalkes" nggak ketemu setelah Validate. Cek manual -- hasil TIDAK dicatat & antrian TIDAK digeser.');
      return false;
    }
    await sleep(500);
    const kfaCode = await waitFor(() => {
      const el = document.querySelector('span[name="kfa_pa_code"]');
      const text = el?.textContent.trim();
      return isValidKfaCode(text) ? text : null;
    }, { timeout: 15000, interval: 500 }).catch(() => null);
    if (!kfaCode) {
      log(`⚠️ Kode KFA (PA) buat "${item.kodeProduk}" masih kosong/placeholder "/" setelah ditunggu 15 detik. Kemungkinan Validate belum beneran sukses. Cek manual -- hasil TIDAK dicatat & antrian TIDAK digeser.`);
      return false;
    }
    log(`🎉 Kode KFA (PA) buat "${item.kodeProduk}" terdeteksi: ${kfaCode}`);
    if (autoFlags.autosave) {
      if (clickByText('button', 'Save', { visibleOnly: true })) {
        log('💾 Save di-klik otomatis.');
      } else {
        log('⚠️ Auto-save aktif tapi tombol Save nggak ketemu -- save manual ya (antrian tetap digeser).');
      }
    } else {
      log('⏸️ Auto-save nggak aktif -- klik Save manual buat commit hasil ini (antrian tetap digeser di panel sekarang).');
    }
    const results = loadResults();
    results.push({ kodeProduk: item.kodeProduk, kfaCode, timestamp: new Date().toISOString() });
    saveResults(results);
    const q = loadQueue();
    if (q.length && q[0].kodeProduk === item.kodeProduk) {
      q.shift();
      saveQueue(q);
      log(`➡️ Antrian digeser. Sisa: ${q.length} SKU.`);
    }
    renderPanel();
    return true;
  }
  // ============================================================
  // QUEUE RUNNER: satu titik masuk buat proses 1 SKU, dan (kalau
  // "Auto-lanjut ke SKU berikutnya" dicentang) otomatis nyambung ke SKU
  // berikutnya selama masih sukses. Berhenti otomatis kalau ada kegagalan
  // di step manapun -- TIDAK maksa lanjut biar bisa dicek manual dulu.
  // ============================================================
  async function processNextInQueue() {
    const q = loadQueue();
    if (!q.length) {
      log('✅ Antrian kosong, nggak ada yang diproses.');
      return;
    }
    const item = q[0];
    const kfaCode = await runProsesB(item);
    if (kfaCode === 'PAUSED_BEFORE_VALIDATE') {
      const success = await watchForManualValidateAndFinish(item);
      if (success) {
        maybeAutoContinue();
      } else {
        log('⛔ Auto-lanjut DIHENTIKAN karena SKU ini gagal/nggak terdeteksi selesai. Cek manual dulu sebelum lanjut.');
      }
      return;
    }
    if (kfaCode) {
      const qNow = loadQueue();
      if (qNow.length && qNow[0].kodeProduk === item.kodeProduk) {
        qNow.shift();
        saveQueue(qNow);
        renderPanel();
      }
      maybeAutoContinue();
    } else {
      log('⛔ Proses B gagal/berhenti di tengah jalan -- auto-lanjut DIHENTIKAN. Perbaiki masalahnya dulu, jangan lanjut ke SKU berikutnya sebelum SKU ini beres.');
    }
  }
  function maybeAutoContinue() {
    if (!autoFlags.autonext) return;
    const q = loadQueue();
    if (!q.length) {
      log('✅ Antrian habis, auto-lanjut selesai.');
      return;
    }
    log(`➡️ Auto-lanjut ke SKU berikutnya: "${q[0].kodeProduk}"...`);
    setTimeout(processNextInQueue, 1200);
  }
  // ---------- Export CSV ----------
  function exportResultsCSV() {
    const results = loadResults();
    if (!results.length) {
      alert('Belum ada hasil buat di-export.');
      return;
    }
    const rows = [['KODE_PRODUK', 'KODE_KFA', 'TIMESTAMP']];
    results.forEach((r) => rows.push([r.kodeProduk, r.kfaCode, r.timestamp]));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kfa_hasil_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  // ---------- v1.10: Export sebagai teks pasteable (TSV) buat Google Sheets ----------
  // Tab-separated: kalau di-paste ke Sheets, tiap TAB otomatis jadi kolom
  // baru dan tiap baris baru otomatis jadi row baru -- sama kayak nge-paste
  // dari Excel.
  function resultsToTSV() {
    const results = loadResults();
    const header = ['KODE_PRODUK', 'KODE_KFA', 'TIMESTAMP'];
    const rows = [header, ...results.map((r) => [r.kodeProduk, r.kfaCode, r.timestamp])];
    return rows.map((r) => r.join('\t')).join('\n');
  }
  function showTsvPreview(text) {
    let box = document.getElementById('kfa-tsv-preview');
    if (!box) return;
    box.style.display = 'block';
    box.value = text;
    box.focus();
    box.select();
  }
  async function copyResultsAsTSV() {
    const results = loadResults();
    if (!results.length) {
      alert('Belum ada hasil buat di-copy.');
      return;
    }
    const text = resultsToTSV();
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }
    if (!copied) {
      // Fallback lawas buat browser/situasi yang nolak Clipboard API
      const tmp = document.createElement('textarea');
      tmp.value = text;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.focus();
      tmp.select();
      try {
        copied = document.execCommand('copy');
      } catch (e) {
        copied = false;
      }
      document.body.removeChild(tmp);
    }
    if (copied) {
      log(`📋 ${results.length} baris hasil ke-copy ke clipboard (format TSV) -- tinggal paste (Ctrl+V) ke Google Sheets.`);
    } else {
      log('⚠️ Copy otomatis ke clipboard gagal (browser mungkin ngeblok). Textarea "Preview hasil" di panel udah ke-select otomatis -- tekan Ctrl+C (atau Cmd+C) manual dari situ.');
    }
    // Selalu tampilin preview-nya juga, biar ada jalan manual kalau copy
    // otomatis gagal / user mau ngecek dulu isinya sebelum paste.
    showTsvPreview(text);
  }
  // ---------- Panel UI ----------
  let panelPos = { top: 70, left: null, right: 10 };
  let panelCollapsed = false;
  // v1.9: state checkbox disimpan DI SINI (bukan cuma di DOM), karena
  // renderPanel() dipanggil berkali-kali di tengah proses (abis Save, abis
  // geser antrian, dst) -- kalau statusnya cuma dibaca dari DOM, tiap kali
  // panel digambar ulang checkbox-nya balik ke unchecked dan auto-lanjut
  // jadi berhenti diam-diam padahal user udah nyentang semuanya.
  let autoFlags = { autovalidate: false, autosave: false, autonext: false };
  function parseQueueInput(text) {
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [kodeProduk, nie, tkdn, brand] = line.split('\t').map((s) => (s || '').trim());
        return { kodeProduk, nie, tkdn, brand: brand || '' };
      });
  }
  function renderPanel() {
    let panel = document.getElementById('kfa-panel');
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.id = 'kfa-panel';
    const posCss = panelPos.left !== null
      ? `top: ${panelPos.top}px; left: ${panelPos.left}px;`
      : `top: ${panelPos.top}px; right: ${panelPos.right}px;`;
    panel.style.cssText = `
      position: fixed; ${posCss} width: 340px; max-height: 85vh;
      overflow-y: auto; background: #fff; border: 2px solid #1F4E78; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25); z-index: 999999; font-family: Arial, sans-serif;
      font-size: 12px; padding: 0;
    `;
    const queue = loadQueue();
    const results = loadResults();
    panel.innerHTML = `
      <div id="kfa-header" style="cursor: move; background:#1F4E78; color:#fff; padding:8px 10px;
           border-radius: 5px 5px 0 0; display:flex; justify-content:space-between; align-items:center;">
        <span style="font-weight:bold; font-size:13px;">KFA Alkes Automation — Pionir</span>
        <span style="display:flex; gap:6px;">
          <button id="kfa-collapse-btn" title="Ciutkan/lebarin panel (atau geser panel ini kalau nutupin tombol/tab di halaman)"
            style="cursor:pointer; background:#fff; color:#1F4E78; border:none; border-radius:3px; width:22px; height:22px; font-weight:bold;">
            ${panelCollapsed ? '▢' : '—'}
          </button>
        </span>
      </div>
      <div id="kfa-body" style="padding: 10px; ${panelCollapsed ? 'display:none;' : ''}">
        <div style="margin-bottom:6px; color:#555;">
          Antrian: <b>${queue.length}</b> SKU | Hasil terkumpul: <b>${results.length}</b>
        </div>
        <textarea id="kfa-queue-input" rows="4" style="width:100%; box-sizing:border-box; font-size:11px;"
          placeholder="KODE_PRODUK[TAB]NIE[TAB]TKDN[TAB]BRAND (satu baris per SKU)"></textarea>
        <button id="kfa-load-queue" style="width:100%; margin-top:4px;">Muat ke Antrian</button>
        <hr>
        <label style="display:block; margin-bottom:4px;">
          <input type="checkbox" id="kfa-autovalidate" ${autoFlags.autovalidate ? 'checked' : ''}> Auto-klik Validate
        </label>
        <label style="display:block; margin-bottom:4px;">
          <input type="checkbox" id="kfa-autosave" ${autoFlags.autosave ? 'checked' : ''}> Auto-klik Save
        </label>
        <label style="display:block; margin-bottom:6px;">
          <input type="checkbox" id="kfa-autonext" ${autoFlags.autonext ? 'checked' : ''}> Auto-lanjut ke SKU berikutnya
        </label>
        <div style="color:#a00; margin-bottom:6px;">
          ⚠️ Data masuk ke sistem KFA nasional. Test 1 SKU manual dulu (semua checkbox OFF) sebelum aktifin auto-validate/save/lanjut.
        </div>
        <div style="color:#1F4E78; margin-bottom:6px; font-style:italic;">
          💡 "Auto-lanjut" bikin script proses SKU demi SKU sendiri abis satu berhasil -- otomatis BERHENTI kalau ada yang gagal, nggak maksa lanjut.
        </div>
        <button id="kfa-run-a" style="width:100%; margin-bottom:4px;">▶ Proses A: Masukin SKU pertama di antrian ke cangkang ini</button>
        <button id="kfa-run-b" style="width:100%; margin-bottom:8px;">▶ Proses B: Validasi SKU pertama di antrian</button>
        <hr>
        <div style="font-weight:bold; margin-bottom:4px;">Bantuan: isi field yang lagi kebuka manual</div>
        <div style="color:#555; margin-bottom:4px;">
          Kotak kode di bawah otomatis keisi dari SKU pertama di antrian, dan otomatis geser ke SKU berikutnya tiap kali berhasil. 1) Klik manual ke field sampai kursor kedip-kedip. 2) Tekan <b>Alt+Enter</b> di keyboard (JANGAN klik tombol -- klik tombol bikin field-nya keblur & mati duluan). Auto-save (kalau dicentang) jalan otomatis setelah berhasil.
        </div>
        <input type="text" id="kfa-assist-input" placeholder="Kode SKU / produk" value="${queue[0]?.kodeProduk ? queue[0].kodeProduk.replace(/"/g, '&quot;') : ''}"
          style="width:100%; box-sizing:border-box; font-size:11px; margin-bottom:4px;">
        <div style="color:#888; margin-bottom:8px; font-size:10px;">
          Tombol di bawah ini fallback lama & BISA GAGAL untuk field yang mati saat blur (mis. Tipe/Type) -- pakai Alt+Enter di atas untuk field itu.
        </div>
        <button id="kfa-run-assist" style="width:100%; margin-bottom:8px;">▶ (fallback) Isi field yang lagi kebuka</button>
        <hr>
        <div style="font-weight:bold; margin-bottom:4px;">Export Hasil</div>
        <button id="kfa-export" style="width:100%; margin-bottom:4px;">⬇ Download CSV</button>
        <button id="kfa-copy-tsv" style="width:100%; margin-bottom:4px;">📋 Copy Hasil (paste ke Google Sheets)</button>
        <textarea id="kfa-tsv-preview" readonly rows="3" style="display:none; width:100%; box-sizing:border-box; font-size:10px; margin-bottom:8px;"
          placeholder="Preview hasil (TSV) muncul di sini setelah klik Copy..."></textarea>
        <button id="kfa-clear" style="width:100%; margin-bottom:6px;">🗑 Reset Antrian & Hasil</button>
        <div style="font-weight:bold; margin-top:4px;">Log:</div>
        <div id="kfa-log" style="max-height:160px; overflow-y:auto; background:#f7f7f7; padding:4px; border:1px solid #ddd;"></div>
      </div>
    `;
    document.body.appendChild(panel);
    const header = document.getElementById('kfa-header');
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartLeft = 0;
    let panelStartTop = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.target.id === 'kfa-collapse-btn') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      panelStartLeft = rect.left;
      panelStartTop = rect.top;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newLeft = panelStartLeft + (e.clientX - dragStartX);
      const newTop = panelStartTop + (e.clientY - dragStartY);
      panel.style.left = `${Math.max(0, newLeft)}px`;
      panel.style.top = `${Math.max(0, newTop)}px`;
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = panel.getBoundingClientRect();
      panelPos = { top: Math.round(rect.top), left: Math.round(rect.left), right: null };
    });
    document.getElementById('kfa-collapse-btn').onclick = () => {
      panelCollapsed = !panelCollapsed;
      renderPanel();
    };
    document.getElementById('kfa-autovalidate').onchange = (e) => {
      autoFlags.autovalidate = e.target.checked;
    };
    document.getElementById('kfa-autosave').onchange = (e) => {
      autoFlags.autosave = e.target.checked;
    };
    document.getElementById('kfa-autonext').onchange = (e) => {
      autoFlags.autonext = e.target.checked;
    };
    const queueInput = document.getElementById('kfa-queue-input');
    queueInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const start = queueInput.selectionStart;
      const end = queueInput.selectionEnd;
      const value = queueInput.value;
      queueInput.value = value.slice(0, start) + '\t' + value.slice(end);
      queueInput.selectionStart = queueInput.selectionEnd = start + 1;
    });
    document.getElementById('kfa-load-queue').onclick = () => {
      const text = document.getElementById('kfa-queue-input').value;
      const items = parseQueueInput(text);
      saveQueue(items);
      log(`Antrian dimuat: ${items.length} SKU.`);
      renderPanel();
    };
    document.getElementById('kfa-run-a').onclick = async () => {
      const q = loadQueue();
      if (!q.length) return alert('Antrian kosong.');
      await runProsesA(q[0].kodeProduk);
    };
    document.getElementById('kfa-run-b').onclick = () => {
      processNextInQueue();
    };
    document.getElementById('kfa-run-assist').onclick = async () => {
      const kodeProduk = document.getElementById('kfa-assist-input').value.trim();
      if (!kodeProduk) return alert('Isi dulu kode SKU / produk-nya.');
      await fillCurrentlyOpenField(kodeProduk);
    };
    document.getElementById('kfa-export').onclick = exportResultsCSV;
    document.getElementById('kfa-copy-tsv').onclick = copyResultsAsTSV;
    document.getElementById('kfa-clear').onclick = () => {
      if (confirm('Yakin reset antrian & hasil? Ini tidak menghapus data di sistem KFA, cuma di panel ini.')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(RESULTS_KEY);
        renderPanel();
      }
    };
  }
  // ---------- Init ----------
  function initKFA() {
    log('Script KFA-AUTO mulai jalan (readyState: ' + document.readyState + ')');
    if (document.getElementById('kfa-panel')) {
      return;
    }
    renderPanel();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initKFA, 1000);
  } else {
    window.addEventListener('load', () => setTimeout(initKFA, 1000));
  }
  let panelCheckTimer = null;
  const bodyObserver = new MutationObserver(() => {
    if (panelCheckTimer) return;
    panelCheckTimer = setTimeout(() => {
      panelCheckTimer = null;
      if (document.body && !document.getElementById('kfa-panel')) {
        renderPanel();
      }
    }, 800);
  });
  if (document.body) {
    bodyObserver.observe(document.body, { childList: true, subtree: false });
  }
})();