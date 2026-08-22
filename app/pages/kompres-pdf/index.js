// kompres-pdf page module: mount(container) / unmount().
// Logic below is the original kompres-pdf.html script, verbatim except that
// every DOM lookup is now scoped to `container` instead of `document`
// (see map.md checklist: "Bungkus kode setup jadi mount(container) + unmount()").

import { KOMPRES_PDF_MARKUP } from './markup.js';

const VENDOR_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
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
  if (window.PDFLib && window.pdfjsLib && window.JSZip) return Promise.resolve();
  if (!vendorReady) vendorReady = Promise.all(VENDOR_SCRIPTS.map(loadScript));
  return vendorReady;
}

function ensureStyle() {
  if (document.getElementById('page-kompres-pdf-style')) return;
  const link = document.createElement('link');
  link.id = 'page-kompres-pdf-style';
  link.rel = 'stylesheet';
  link.href = new URL('./style.css', import.meta.url).href;
  document.head.appendChild(link);
}

let mountedContainer = null;

export async function mount(container) {
  mountedContainer = container;
  ensureStyle();
  await ensureVendorScripts();
  container.classList.add('wrap'); // style.css's .wrap sets max-width/centering, previously the outer <div class="wrap">
  container.innerHTML = KOMPRES_PDF_MARKUP;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  
  // Ladder of compression tiers, least → most aggressive.
  // The first 4 are user-facing presets; the rest are only used when
  // a target size is set and the tool needs to push further automatically.
  const LADDER = [
    { key:'ringan',  label:'Ringan',  quality:0.82, dpi:150, maxDimension:null },
    { key:'sedang',  label:'Sedang',  quality:0.65, dpi:120, maxDimension:2000 },
    { key:'kuat',    label:'Kuat',    quality:0.45, dpi:96,  maxDimension:1400 },
    { key:'ekstrem', label:'Ekstrem', quality:0.30, dpi:72,  maxDimension:1000 },
    { key:'ekstrem+1', label:'Ekstrem+',  quality:0.22, dpi:60, maxDimension:800 },
    { key:'ekstrem+2', label:'Ekstrem++', quality:0.16, dpi:48, maxDimension:650 },
    { key:'ekstrem+3', label:'Ekstrem+++',quality:0.12, dpi:38, maxDimension:500 },
    { key:'ekstrem+4', label:'Maksimal',  quality:0.10, dpi:30, maxDimension:380 },
  ];
  const LEVELS = Object.fromEntries(LADDER.slice(0,4).map(t => [t.key, t]));
  const LEVEL_ORDER = LADDER.slice(0,4).map(t => t.key);
  
  const MODE_DESC = {
    whole: 'Setiap halaman diubah menjadi gambar terkompresi lalu disusun ulang jadi PDF baru. Paling efektif untuk PDF hasil scan/foto. Untuk dokumen berbasis teks (misalnya ekspor dari Word), cara ini bisa saja menghasilkan ukuran lebih besar dari aslinya — gunakan mode "Hanya Gambar" untuk dokumen semacam itu. Teks pada hasil juga tidak lagi bisa diseleksi atau dicari.',
    images: 'Hanya gambar (foto/JPEG) di dalam PDF yang dikompres ulang. Teks tetap tajam, bisa diseleksi, dan dicari seperti biasa. Cocok untuk PDF hasil scan atau berisi banyak foto. Jika PDF tidak berisi gambar, ukurannya akan tetap sama.',
  };
  
  let uid = 0;
  let state = {
    items: [],       // {id, file, arrayBuffer, status, resultBytes, resultName, originalSize, newSize, errorMsg, note, tierLabel, targetReached}
    mode: 'whole',
    level: 'sedang',
    targetBytes: null,
    processing: false,
  };
  
  const $ = id => container.querySelector('#' + id);
  const dropzone = $('dropzone'), fileInput = $('fileInput');
  const listBlock = $('listBlock'), listCount = $('listCount'), fileList = $('fileList'), addMoreBtn = $('addMoreBtn');
  const optionsBlock = $('optionsBlock'), modeSeg = $('modeSeg'), levelSeg = $('levelSeg');
  const modeDesc = $('modeDesc'), modeHint = $('modeHint'), levelHint = $('levelHint'), gauge = $('gauge');
  const compressBtn = $('compressBtn'), compressBtnLabel = $('compressBtnLabel'), progressBlock = $('progressBlock');
  const progressFill = $('progressFill'), progressText = $('progressText'), progressPct = $('progressPct');
  const errorBox = $('errorBox'), errorText = $('errorText');
  const uploadCard = $('uploadCard'), resultCard = $('resultCard');
  const resultTitle = $('resultTitle'), resultSub = $('resultSub'), origSize = $('origSize'), newSize = $('newSize');
  const afterBar = $('afterBar'), reductionPill = $('reductionPill'), resultNote = $('resultNote');
  const downloadBtn = $('downloadBtn'), downloadBtnLabel = $('downloadBtnLabel'), resetBtn = $('resetBtn');
  const targetInput = $('targetInput'), targetChips = $('targetChips');
  const resultFileListBlock = $('resultFileListBlock'), resultFileList = $('resultFileList');
  
  function formatBytes(bytes){
    if (bytes < 1024) return bytes + ' B';
    const units = ['KB','MB','GB'];
    let val = bytes / 1024, i = 0;
    while (val >= 1024 && i < units.length - 1){ val /= 1024; i++; }
    return val.toFixed(val >= 10 ? 0 : 1) + ' ' + units[i];
  }
  
  function showError(msg){
    errorText.textContent = msg;
    errorBox.classList.remove('hidden');
  }
  function clearError(){ errorBox.classList.add('hidden'); }
  
  function renderModeDesc(){
    modeDesc.textContent = MODE_DESC[state.mode];
    modeHint.textContent = state.mode === 'whole' ? 'Kompresi maksimal' : 'Kualitas teks terjaga';
  }
  function renderLevelGauge(){
    const idx = LEVEL_ORDER.indexOf(state.level);
    [...gauge.children].forEach((el,i) => el.classList.toggle('on', i <= idx));
    levelHint.textContent = LEVELS[state.level].label;
  }
  
  modeSeg.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    state.mode = btn.dataset.mode;
    [...modeSeg.children].forEach(b => b.classList.toggle('active', b === btn));
    renderModeDesc();
  });
  levelSeg.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    state.level = btn.dataset.level;
    [...levelSeg.children].forEach(b => b.classList.toggle('active', b === btn));
    renderLevelGauge();
  });
  
  function setTargetFromValue(mb){
    targetInput.value = mb ? mb : '';
    syncTargetChips();
  }
  function syncTargetChips(){
    const v = targetInput.value.trim();
    [...targetChips.children].forEach(chip => {
      chip.classList.toggle('active', chip.dataset.val === v);
    });
  }
  targetChips.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    setTargetFromValue(btn.dataset.val);
  });
  targetInput.addEventListener('input', syncTargetChips);
  
  function fileItemIcon(status){
    if (status === 'error'){
      return `<div class="file-icon error"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg></div>`;
    }
    return `<div class="file-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6" stroke-linejoin="round"/></svg></div>`;
  }
  
  function badgeFor(item){
    switch(item.status){
      case 'pending': return `<span class="badge">Menunggu</span>`;
      case 'processing': return `<span class="badge processing">Memproses</span>`;
      case 'done': {
        const sizeTxt = item.reduction > 0 ? `Selesai &middot; -${item.reduction}%` : 'Sudah optimal';
        const targetTxt = item.targetReached === false ? ` &middot; belum capai target` : '';
        return `<span class="badge done">${sizeTxt}${targetTxt}</span>`;
      }
      case 'error': return `<span class="badge error">Gagal</span>`;
    }
  }
  
  function renderList(){
    listCount.textContent = state.items.length + (state.items.length === 1 ? ' file' : ' file');
    fileList.innerHTML = state.items.map(item => {
      const showMiniProgress = item.status === 'processing';
      const showDownload = item.status === 'done';
      const showRemove = item.status === 'pending' && !state.processing;
      return `
      <div class="file-item" data-id="${item.id}">
        ${fileItemIcon(item.status)}
        <div class="file-meta">
          <div class="file-name">${item.file.name}</div>
          <div class="file-status">
            ${badgeFor(item)}
            <span>${item.status === 'done' ? formatBytes(item.originalSize) + ' &rarr; ' + formatBytes(item.newSize) : formatBytes(item.originalSize)}</span>
          </div>
          ${showMiniProgress ? `<div class="file-mini-progress"><div class="file-mini-fill" style="width:${item.progress||0}%"></div></div>` : ''}
          ${item.status === 'error' ? `<div class="file-status" style="color:var(--danger);margin-top:4px;">${item.errorMsg||''}</div>` : ''}
        </div>
        <div class="file-actions">
          ${showDownload ? `<button class="icon-btn accent" title="Unduh" data-action="download" data-id="${item.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5M4 21h16" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
          ${showRemove ? `<button class="icon-btn" title="Hapus" data-action="remove" data-id="${item.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  
  fileList.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]'); if (!btn) return;
    const id = Number(btn.dataset.id);
    const item = state.items.find(it => it.id === id);
    if (!item) return;
    if (btn.dataset.action === 'remove'){
      state.items = state.items.filter(it => it.id !== id);
      if (state.items.length === 0){
        resetAll();
      } else {
        renderList();
        updateCompressLabel();
      }
    } else if (btn.dataset.action === 'download'){
      downloadItem(item);
    }
  });
  
  function downloadItem(item){
    const blob = new Blob([item.resultBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = item.resultName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  function updateCompressLabel(){
    const n = state.items.length;
    compressBtnLabel.textContent = n <= 1 ? 'Kompres PDF' : `Kompres ${n} File`;
  }
  
  function addFiles(fileListRaw){
    clearError();
    const files = Array.from(fileListRaw || []);
    if (files.length === 0) return;
    const rejected = [];
    files.forEach(file => {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf){ rejected.push(file.name); return; }
      state.items.push({
        id: ++uid,
        file,
        arrayBuffer: null,
        status: 'pending',
        progress: 0,
        resultBytes: null,
        resultName: '',
        originalSize: file.size,
        newSize: 0,
        reduction: 0,
        errorMsg: '',
      });
    });
    if (rejected.length){
      showError(`File berikut dilewati karena bukan PDF: ${rejected.join(', ')}`);
    }
    if (state.items.length > 0){
      dropzone.classList.add('hidden');
      listBlock.classList.remove('hidden');
      optionsBlock.classList.remove('hidden');
      renderModeDesc();
      renderLevelGauge();
      renderList();
      updateCompressLabel();
    }
  }
  
  dropzone.addEventListener('click', () => fileInput.click());
  addMoreBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => { addFiles(e.target.files); fileInput.value = ''; });
  ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault(); dropzone.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, e => {
    e.preventDefault(); dropzone.classList.remove('drag');
  }));
  dropzone.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  
  function setOverallProgress(frac, label){
    const pct = Math.round(frac * 100);
    progressFill.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    if (label) progressText.textContent = label;
  }
  
  async function readAsArrayBuffer(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca file'));
      reader.readAsArrayBuffer(file);
    });
  }
  
  // Runs `fn` over `items` with up to `limit` concurrent in-flight calls.
  // Lets page rendering / image decode-encode overlap instead of running
  // one strictly after another, which is the main speed win here.
  async function mapWithConcurrency(items, limit, fn){
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker(){
      while (nextIndex < items.length){
        const current = nextIndex++;
        results[current] = await fn(items[current], current);
      }
    }
    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }
  
  const CORES = (navigator.hardwareConcurrency || 4);
  const PAGE_RENDER_CONCURRENCY = Math.max(2, Math.min(6, CORES - 1));
  const ENCODE_CONCURRENCY = Math.max(2, Math.min(8, CORES));
  
  // --- WHOLE DOCUMENT MODE ---
  // Renders every page ONCE at the highest resolution the current run might
  // need, caching each as an ImageBitmap. Every escalation tier after that
  // just downsamples the cached bitmap and re-encodes — no repeat pdf.js
  // rendering, which is by far the slowest step.
  async function renderPagesToCache(arrayBuffer, dpi, onProgress){
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
    const pdf = await loadingTask.promise;
    const scale = dpi / 72;
    const pageNums = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const cache = new Array(pdf.numPages);
    let done = 0;
  
    await mapWithConcurrency(pageNums, PAGE_RENDER_CONCURRENCY, async (pageNum) => {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const baseViewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      cache[pageNum - 1] = { canvas, baseW: baseViewport.width, baseH: baseViewport.height, renderedW: canvas.width, renderedH: canvas.height };
      done++;
      onProgress(done / pdf.numPages, `Merender halaman ${done} dari ${pdf.numPages}…`);
    });
    return cache;
  }
  
  async function buildPdfFromCache(pageCache, settings, onProgress){
    const outDoc = await PDFLib.PDFDocument.create();
    const targetScale = settings.dpi / 72;
    const jpegs = new Array(pageCache.length);
    let done = 0;
  
    await mapWithConcurrency(pageCache.map((_, i) => i), ENCODE_CONCURRENCY, async (i) => {
      const entry = pageCache[i];
      const w = Math.min(Math.max(1, Math.round(entry.baseW * targetScale)), entry.renderedW);
      const h = Math.min(Math.max(1, Math.round(entry.baseH * targetScale)), entry.renderedH);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(entry.canvas, 0, 0, w, h);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', settings.quality));
      jpegs[i] = new Uint8Array(await blob.arrayBuffer());
      canvas.width = 0; canvas.height = 0;
      done++;
      onProgress(done / pageCache.length, `Mengompres halaman ${done} dari ${pageCache.length}…`);
    });
  
    // Assembling the PDF itself must stay sequential (page order matters),
    // but it's cheap now that all JPEGs are already encoded.
    for (let i = 0; i < pageCache.length; i++){
      const entry = pageCache[i];
      const jpgImage = await outDoc.embedJpg(jpegs[i]);
      const newPage = outDoc.addPage([entry.baseW, entry.baseH]);
      newPage.drawImage(jpgImage, { x: 0, y: 0, width: entry.baseW, height: entry.baseH });
    }
    return await outDoc.save({ useObjectStreams: false });
  }
  
  function closePageCache(pageCache){
    pageCache.forEach(entry => { try { entry.canvas.width = 0; entry.canvas.height = 0; } catch (_){} });
  }
  
  // --- IMAGES-ONLY MODE ---
  // Parses the PDF and decodes every target JPEG ONCE, caching the bitmap.
  // Every escalation tier re-encodes straight from that original bitmap
  // (never from a previously-recompressed copy), so quality doesn't
  // compound and no image is ever decoded twice.
  async function extractImageCache(arrayBuffer, onProgress){
    const { PDFDocument, PDFName, PDFRawStream } = PDFLib;
    const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true, updateMetadata: false });
    const context = pdfDoc.context;
  
    const targets = [];
    for (const [, obj] of context.enumerateIndirectObjects()){
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Image') continue;
      const filter = dict.get(PDFName.of('Filter'));
      const filterStr = filter ? filter.toString() : '';
      const colorSpace = dict.get(PDFName.of('ColorSpace'));
      const csStr = colorSpace ? colorSpace.toString() : '';
      if (filterStr === '/DCTDecode' && csStr !== '/DeviceCMYK'){
        targets.push(obj);
      }
    }
  
    const cache = [];
    let done = 0;
    await mapWithConcurrency(targets, ENCODE_CONCURRENCY, async (obj) => {
      try {
        const original = obj.contents;
        const blob = new Blob([original], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);
        cache.push({ obj, bitmap, originalSize: original.length });
      } catch (e){
        console.warn('Lewati satu gambar (gagal dekode):', e);
      }
      done++;
      onProgress(done / Math.max(1, targets.length), `Membaca gambar ${done} dari ${targets.length}…`);
    });
  
    return { pdfDoc, cache, imagesFound: targets.length };
  }
  
  async function applyImagesTier({ pdfDoc, cache }, settings, onProgress){
    const { PDFName } = PDFLib;
    let done = 0;
    let compressedCount = 0;
  
    await mapWithConcurrency(cache, ENCODE_CONCURRENCY, async (entry) => {
      const { obj, bitmap, originalSize } = entry;
      let { width, height } = bitmap;
      let scale = 1;
      if (settings.maxDimension && Math.max(width, height) > settings.maxDimension){
        scale = settings.maxDimension / Math.max(width, height);
      }
      const newW = Math.max(1, Math.round(width * scale));
      const newH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = newW; canvas.height = newH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, newW, newH);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', settings.quality));
      const newBytes = new Uint8Array(await blob.arrayBuffer());
      if (newBytes.length < originalSize){
        obj.contents = newBytes;
        obj.dict.set(PDFName.of('Width'), PDFLib.PDFNumber.of(newW));
        obj.dict.set(PDFName.of('Height'), PDFLib.PDFNumber.of(newH));
        obj.dict.delete(PDFName.of('DecodeParms'));
        obj.dict.delete(PDFName.of('SMaskInData'));
        compressedCount++;
      }
      canvas.width = 0; canvas.height = 0;
      done++;
      onProgress(done / cache.length, `Mengompres gambar ${done} dari ${cache.length}…`);
    });
  
    const bytes = await pdfDoc.save({ useObjectStreams: false });
    return { bytes, compressedCount };
  }
  
  function closeImageCache(cache){
    cache.forEach(entry => { try { entry.bitmap.close && entry.bitmap.close(); } catch (_){} });
  }
  
  async function processItem(item, targetBytes, onItemProgress){
    item.arrayBuffer = await readAsArrayBuffer(item.file);
    const startIdx = LEVEL_ORDER.indexOf(state.level);
    const totalPossible = targetBytes ? (LADDER.length - startIdx) : 1;
    const startSettings = LADDER[startIdx];
  
    if (state.mode === 'whole'){
      const pageCache = await renderPagesToCache(item.arrayBuffer, startSettings.dpi, (frac, label) => {
        onItemProgress(frac * 0.35, 'Merender', 0);
      });
  
      let idx = startIdx, best = null, prevSize = Infinity;
      while (true){
        const settings = LADDER[idx];
        const attemptsSoFar = idx - startIdx + 1;
        const resultBytes = await buildPdfFromCache(pageCache, settings, (frac) => {
          const tierFrac = ((idx - startIdx) + frac) / totalPossible;
          onItemProgress(0.35 + Math.min(0.64, tierFrac * 0.65), settings.label, attemptsSoFar);
        });
        if (!best || resultBytes.byteLength < best.resultBytes.byteLength){
          best = { resultBytes, note: 'whole', tierLabel: settings.label };
        }
        const size = resultBytes.byteLength;
        const reachedTarget = targetBytes && size <= targetBytes;
        const atLadderEnd = idx >= LADDER.length - 1;
        const diminishing = (prevSize - size) < prevSize * 0.03 && idx > startIdx;
        if (!targetBytes || reachedTarget || atLadderEnd || diminishing){
          closePageCache(pageCache);
          return { ...best, targetReached: targetBytes ? reachedTarget : null };
        }
        prevSize = size;
        idx++;
      }
    }
  
    // images-only mode
    const { pdfDoc, cache, imagesFound } = await extractImageCache(item.arrayBuffer, (frac, label) => {
      onItemProgress(frac * 0.3, 'Membaca gambar', 0);
    });
  
    if (cache.length === 0){
      const bytes = await pdfDoc.save({ useObjectStreams: false });
      return {
        resultBytes: bytes,
        note: 'no-images',
        tierLabel: startSettings.label,
        targetReached: targetBytes ? (bytes.byteLength <= targetBytes) : null,
      };
    }
  
    let idx = startIdx, best = null, prevSize = Infinity;
    while (true){
      const settings = LADDER[idx];
      const attemptsSoFar = idx - startIdx + 1;
      const { bytes, compressedCount } = await applyImagesTier({ pdfDoc, cache }, settings, (frac) => {
        const tierFrac = ((idx - startIdx) + frac) / totalPossible;
        onItemProgress(0.3 + Math.min(0.69, tierFrac * 0.7), settings.label, attemptsSoFar);
      });
      const note = `images:${compressedCount}/${imagesFound}`;
      if (!best || bytes.byteLength < best.resultBytes.byteLength){
        best = { resultBytes: bytes, note, tierLabel: settings.label };
      }
      const size = bytes.byteLength;
      const reachedTarget = targetBytes && size <= targetBytes;
      const atLadderEnd = idx >= LADDER.length - 1;
      const diminishing = (prevSize - size) < prevSize * 0.03 && idx > startIdx;
      if (!targetBytes || reachedTarget || atLadderEnd || diminishing){
        closeImageCache(cache);
        return { ...best, targetReached: targetBytes ? reachedTarget : null };
      }
      prevSize = size;
      idx++;
    }
  }
  
  compressBtn.addEventListener('click', async () => {
    if (state.items.length === 0 || state.processing) return;
    clearError();
  
    const targetMb = parseFloat(targetInput.value);
    const targetBytes = (!isNaN(targetMb) && targetMb > 0) ? Math.round(targetMb * 1024 * 1024) : null;
    state.targetBytes = targetBytes;
  
    state.processing = true;
    optionsBlock.classList.add('hidden');
    listBlock.classList.add('hidden');
    progressBlock.classList.remove('hidden');
    compressBtn.disabled = true;
    setOverallProgress(0, 'Memulai…');
  
    const total = state.items.length;
    let anyError = false;
  
    for (let idx = 0; idx < total; idx++){
      const item = state.items[idx];
      item.status = 'processing';
      item.progress = 0;
      try {
        let { resultBytes, note, tierLabel, targetReached } = await processItem(item, targetBytes, (frac, label, attemptNum) => {
          item.progress = Math.round(frac * 100);
          const overall = (idx + frac) / total;
          const attemptTxt = attemptNum > 1 ? ` (percobaan ${attemptNum}, tingkat ${label})` : '';
          setOverallProgress(overall, `Memproses file ${idx + 1} dari ${total}: ${item.file.name}${attemptTxt}`);
        });
        // Safeguard: never hand back a file larger than the original.
        if (resultBytes.byteLength >= item.originalSize){
          resultBytes = new Uint8Array(item.arrayBuffer);
          note = note === 'no-images' ? 'no-images' : 'kept-original';
          targetReached = targetBytes ? (resultBytes.byteLength <= targetBytes) : targetReached;
        }
        item.resultBytes = resultBytes;
        item.newSize = resultBytes.byteLength;
        item.resultName = item.file.name.replace(/\.pdf$/i, '') + '-kompres.pdf';
        item.reduction = Math.max(0, Math.round((1 - item.newSize / item.originalSize) * 100));
        item.note = note;
        item.tierLabel = tierLabel;
        item.targetReached = targetReached;
        item.status = 'done';
      } catch (err){
        console.error(err);
        item.status = 'error';
        item.errorMsg = 'Gagal memproses (file rusak, terkunci, atau tidak didukung).';
        anyError = true;
      }
      setOverallProgress((idx + 1) / total, `Selesai ${idx + 1} dari ${total} file`);
    }
  
    state.processing = false;
    compressBtn.disabled = false;
    progressBlock.classList.add('hidden');
    showSummary(anyError);
  });
  
  function renderResultFileList(){
    resultFileList.innerHTML = state.items.map(item => {
      const sizeLine = item.status === 'done'
        ? `${formatBytes(item.originalSize)} &rarr; ${formatBytes(item.newSize)}`
        : formatBytes(item.originalSize);
      return `
      <div class="file-item" data-id="${item.id}">
        ${fileItemIcon(item.status)}
        <div class="file-meta">
          <div class="file-name">${item.file.name}</div>
          <div class="file-status">
            ${badgeFor(item)}
            <span>${sizeLine}</span>
          </div>
          ${item.status === 'error' ? `<div class="file-status" style="color:var(--danger);margin-top:4px;">${item.errorMsg || ''}</div>` : ''}
        </div>
        <div class="file-actions">
          ${item.status === 'done' ? `<button class="icon-btn accent" title="Unduh" data-action="download-result" data-id="${item.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5M4 21h16" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  
  resultFileList.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action="download-result"]'); if (!btn) return;
    const item = state.items.find(it => it.id === Number(btn.dataset.id));
    if (item && item.status === 'done') downloadItem(item);
  });
  
  function showSummary(anyError){
    const doneItems = state.items.filter(it => it.status === 'done');
    const totalOriginal = doneItems.reduce((s, it) => s + it.originalSize, 0);
    const totalNew = doneItems.reduce((s, it) => s + it.newSize, 0);
    const reduction = totalOriginal > 0 ? Math.max(0, Math.round((1 - totalNew / totalOriginal) * 100)) : 0;
    const errorCount = state.items.filter(it => it.status === 'error').length;
  
    const multi = state.items.length > 1;
    resultTitle.textContent = anyError ? 'Kompresi selesai dengan beberapa kendala' : 'Kompresi selesai';
    resultSub.textContent = multi
      ? `${doneItems.length} dari ${state.items.length} file berhasil dikompres${errorCount ? `, ${errorCount} gagal` : ''}`
      : (doneItems[0] ? doneItems[0].resultName : 'Gagal memproses file');
  
    origSize.textContent = formatBytes(totalOriginal);
    newSize.textContent = formatBytes(totalNew);
    reductionPill.innerHTML = reduction > 0 ? `&darr; ${reduction}% lebih kecil` : `Ukuran tidak banyak berubah`;
  
    resultFileListBlock.classList.toggle('hidden', !multi);
    if (multi) renderResultFileList();
  
    const keptOriginal = doneItems.filter(it => it.note === 'kept-original').length;
    const noImages = doneItems.filter(it => it.note === 'no-images').length;
    const targetMissed = state.targetBytes ? doneItems.filter(it => it.targetReached === false).length : 0;
  
    let noteText;
    if (doneItems.length === 0){
      noteText = 'Semua file gagal diproses. Periksa apakah file PDF valid dan tidak terkunci kata sandi, lalu coba lagi.';
    } else if (state.mode === 'whole'){
      noteText = 'Setiap halaman diubah menjadi gambar sehingga teks tidak lagi bisa diseleksi atau dicari. Gunakan mode "Hanya Gambar" bila ingin teks tetap dapat dicari.';
      if (keptOriginal > 0){
        noteText += ` ${keptOriginal} file ternyata membengkak jika dirasterisasi (biasanya karena isinya teks/vektor, bukan hasil scan) — untuk file itu, versi asli dipertahankan apa adanya.`;
      }
    } else {
      noteText = 'Teks tetap tajam dan bisa dicari seperti biasa.';
      if (noImages > 0){
        noteText += ` ${noImages} file tidak memiliki gambar JPEG untuk dikompres, sehingga ukurannya tetap sama seperti aslinya.`;
      }
      if (keptOriginal > 0){
        noteText += ` ${keptOriginal} file gambarnya sudah cukup terkompresi, sehingga tidak ada ukuran yang bisa dihemat lagi.`;
      }
    }
    if (state.targetBytes){
      if (targetMissed > 0){
        noteText += ` ${targetMissed} dari ${doneItems.length} file tidak berhasil mencapai target ${formatBytes(state.targetBytes)} meski sudah dikompres dengan tingkat paling agresif (kemungkinan berisi banyak teks/vektor yang tak bisa dikecilkan lebih jauh) — ukuran terbaik yang bisa dicapai tetap digunakan.`;
      } else {
        noteText += ` Semua file berhasil dikompres di bawah target ${formatBytes(state.targetBytes)}.`;
      }
    }
    resultNote.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01" stroke-linecap="round"/></svg><span>${noteText}</span>`;
  
    downloadBtnLabel.textContent = multi ? `Unduh Semua (ZIP, ${doneItems.length} file)` : 'Unduh PDF Hasil Kompresi';
    downloadBtn.classList.toggle('hidden', doneItems.length === 0);
    downloadBtn.dataset.multi = multi ? '1' : '0';
  
    uploadCard.classList.add('hidden');
    resultCard.classList.remove('hidden');
    requestAnimationFrame(() => {
      afterBar.style.width = Math.max(4, 100 - reduction) + '%';
    });
  }
  
  downloadBtn.addEventListener('click', async () => {
    const doneItems = state.items.filter(it => it.status === 'done');
    if (doneItems.length === 0) return;
    if (downloadBtn.dataset.multi === '1'){
      downloadBtn.disabled = true;
      const originalLabel = downloadBtnLabel.textContent;
      downloadBtnLabel.textContent = 'Menyiapkan ZIP…';
      try {
        const zip = new JSZip();
        const usedNames = new Set();
        doneItems.forEach(item => {
          let name = item.resultName;
          let n = 1;
          while (usedNames.has(name)){
            name = item.resultName.replace(/\.pdf$/i, `-${n}.pdf`);
            n++;
          }
          usedNames.add(name);
          zip.file(name, item.resultBytes);
        });
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'pdf-terkompresi.zip';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } finally {
        downloadBtn.disabled = false;
        downloadBtnLabel.textContent = originalLabel;
      }
    } else {
      downloadItem(doneItems[0]);
    }
  });
  
  resetBtn.addEventListener('click', resetAll);
  
  function resetAll(){
    uid = 0;
    state = { items: [], mode: 'whole', level: 'sedang', targetBytes: null, processing: false };
    fileInput.value = '';
    dropzone.classList.remove('hidden');
    listBlock.classList.add('hidden');
    fileList.innerHTML = '';
    optionsBlock.classList.add('hidden');
    progressBlock.classList.add('hidden');
    setOverallProgress(0, 'Memproses…');
    clearError();
    [...modeSeg.children].forEach(b => b.classList.toggle('active', b.dataset.mode === 'whole'));
    [...levelSeg.children].forEach(b => b.classList.toggle('active', b.dataset.level === 'sedang'));
    targetInput.value = '';
    syncTargetChips();
    resultFileList.innerHTML = '';
    resultFileListBlock.classList.add('hidden');
    resultCard.classList.add('hidden');
    uploadCard.classList.remove('hidden');
  }
  
  renderModeDesc();
  renderLevelGauge();
  syncTargetChips();
  
  /* ============================================================ */
  /* TAB SWITCHING                                                 */
  /* ============================================================ */
  const tabPanels = {
    compress: container.querySelector('#panel-compress'),
    split: container.querySelector('#panel-split'),
    merge: container.querySelector('#panel-merge'),
  };
  container.querySelector('#tabbar').addEventListener('click', e => {
    const btn = e.target.closest('button.tab'); if (!btn) return;
    container.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    Object.entries(tabPanels).forEach(([key, el]) => el.classList.toggle('active', key === btn.dataset.tab));
  });
  
  function triggerDownload(bytes, filename, mime = 'application/pdf'){
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  /* ============================================================ */
  /* SPLIT PDF                                                     */
  /* ============================================================ */
  const splitDropzone = $('splitDropzone'), splitFileInput = $('splitFileInput'), splitFileRow = $('splitFileRow');
  const splitFileName = $('splitFileName'), splitFileMeta = $('splitFileMeta'), splitFileRemove = $('splitFileRemove');
  const splitOptionsBlock = $('splitOptionsBlock'), splitModeSeg = $('splitModeSeg'), splitModeDesc = $('splitModeDesc');
  const splitRangeField = $('splitRangeField'), splitRangeInput = $('splitRangeInput'), splitBtn = $('splitBtn');
  const splitProgressBlock = $('splitProgressBlock'), splitProgressFill = $('splitProgressFill');
  const splitProgressText = $('splitProgressText'), splitProgressPct = $('splitProgressPct');
  const splitErrorBox = $('splitErrorBox'), splitErrorText = $('splitErrorText');
  const splitUploadCard = $('splitUploadCard'), splitResultCard = $('splitResultCard');
  const splitResultSub = $('splitResultSub'), splitResultList = $('splitResultList');
  const splitDownloadAllBtn = $('splitDownloadAllBtn'), splitDownloadAllLabel = $('splitDownloadAllLabel');
  const splitResetBtn = $('splitResetBtn');
  
  let splitState = { file: null, arrayBuffer: null, pageCount: 0, mode: 'each', results: [] };
  
  function showSplitError(msg){ splitErrorText.textContent = msg; splitErrorBox.classList.remove('hidden'); }
  function clearSplitError(){ splitErrorBox.classList.add('hidden'); }
  function setSplitProgress(frac, label){
    const pct = Math.round(frac * 100);
    splitProgressFill.style.width = pct + '%';
    splitProgressPct.textContent = pct + '%';
    if (label) splitProgressText.textContent = label;
  }
  
  async function handleSplitFile(file){
    clearSplitError();
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf){ showSplitError('Format file tidak didukung. Silakan pilih file PDF (.pdf).'); return; }
    try {
      const buf = await readAsArrayBuffer(file);
      const doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
      const pageCount = doc.getPageCount();
      splitState.file = file;
      splitState.arrayBuffer = buf;
      splitState.pageCount = pageCount;
      splitFileName.textContent = file.name;
      splitFileMeta.textContent = `${pageCount} halaman · ${formatBytes(file.size)}`;
      splitDropzone.classList.add('hidden');
      splitFileRow.classList.remove('hidden');
      splitOptionsBlock.classList.remove('hidden');
    } catch (e){
      console.error(e);
      showSplitError('Gagal membaca PDF. File mungkin rusak atau terkunci kata sandi.');
    }
  }
  
  splitDropzone.addEventListener('click', () => splitFileInput.click());
  splitFileInput.addEventListener('change', e => { handleSplitFile(e.target.files[0]); splitFileInput.value = ''; });
  ['dragenter','dragover'].forEach(evt => splitDropzone.addEventListener(evt, e => { e.preventDefault(); splitDropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => splitDropzone.addEventListener(evt, e => { e.preventDefault(); splitDropzone.classList.remove('drag'); }));
  splitDropzone.addEventListener('drop', e => handleSplitFile(e.dataTransfer.files[0]));
  splitFileRemove.addEventListener('click', resetSplit);
  
  splitModeSeg.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    splitState.mode = btn.dataset.mode;
    [...splitModeSeg.children].forEach(b => b.classList.toggle('active', b === btn));
    splitRangeField.classList.toggle('hidden', splitState.mode !== 'range');
    splitModeDesc.textContent = splitState.mode === 'each'
      ? 'Setiap halaman akan menjadi file PDF terpisah.'
      : 'Tentukan rentang halaman Anda sendiri di kolom di bawah.';
  });
  
  function parseSplitRanges(rangeStr, pageCount){
    const parts = rangeStr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) throw new Error('Isi rentang halaman terlebih dahulu, misal: 1-3, 4, 7-10.');
    const ranges = [];
    for (const part of parts){
      const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) throw new Error(`Format rentang tidak dikenali: "${part}".`);
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : start;
      if (start < 1 || end > pageCount || start > end){
        throw new Error(`Rentang "${part}" di luar jangkauan (dokumen punya ${pageCount} halaman).`);
      }
      ranges.push([start - 1, end - 1]);
    }
    return ranges;
  }
  
  splitBtn.addEventListener('click', async () => {
    clearSplitError();
    if (!splitState.arrayBuffer) return;
  
    let ranges;
    try {
      ranges = splitState.mode === 'each'
        ? Array.from({ length: splitState.pageCount }, (_, i) => [i, i])
        : parseSplitRanges(splitRangeInput.value, splitState.pageCount);
    } catch (e){
      showSplitError(e.message);
      return;
    }
  
    splitOptionsBlock.classList.add('hidden');
    splitFileRow.classList.add('hidden');
    splitProgressBlock.classList.remove('hidden');
    splitBtn.disabled = true;
    setSplitProgress(0, 'Memulai…');
  
    try {
      const srcDoc = await PDFLib.PDFDocument.load(splitState.arrayBuffer, { ignoreEncryption: true });
      const baseName = splitState.file.name.replace(/\.pdf$/i, '');
      const results = [];
      for (let i = 0; i < ranges.length; i++){
        const [start, end] = ranges[i];
        const newDoc = await PDFLib.PDFDocument.create();
        const indices = Array.from({ length: end - start + 1 }, (_, k) => start + k);
        const copied = await newDoc.copyPages(srcDoc, indices);
        copied.forEach(p => newDoc.addPage(p));
        const bytes = await newDoc.save({ useObjectStreams: false });
        const label = start === end ? `hal-${start + 1}` : `hal-${start + 1}-${end + 1}`;
        results.push({ name: `${baseName}-${label}.pdf`, bytes, pageCount: end - start + 1 });
        setSplitProgress((i + 1) / ranges.length, `Memisahkan ${i + 1} dari ${ranges.length}…`);
      }
      splitState.results = results;
      showSplitResult();
    } catch (e){
      console.error(e);
      splitProgressBlock.classList.add('hidden');
      splitOptionsBlock.classList.remove('hidden');
      splitFileRow.classList.remove('hidden');
      showSplitError('Gagal memisah PDF. File mungkin rusak atau terkunci kata sandi.');
    } finally {
      splitBtn.disabled = false;
    }
  });
  
  function showSplitResult(){
    const n = splitState.results.length;
    splitResultSub.textContent = `${n} file dari "${splitState.file.name}"`;
    splitResultList.innerHTML = splitState.results.map((r, i) => `
      <div class="file-item">
        <div class="file-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6" stroke-linejoin="round"/></svg></div>
        <div class="file-meta">
          <div class="file-name">${r.name}</div>
          <div class="file-status"><span>${r.pageCount} halaman · ${formatBytes(r.bytes.byteLength)}</span></div>
        </div>
        <div class="file-actions">
          <button class="icon-btn accent" title="Unduh" data-idx="${i}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10m0 0l-3.5-3.5M12 13l3.5-3.5M4 21h16" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>`).join('');
    splitDownloadAllLabel.textContent = n > 1 ? `Unduh Semua (ZIP, ${n} file)` : 'Unduh File';
    splitUploadCard.classList.add('hidden');
    splitProgressBlock.classList.add('hidden');
    splitResultCard.classList.remove('hidden');
  }
  
  splitResultList.addEventListener('click', e => {
    const btn = e.target.closest('button[data-idx]'); if (!btn) return;
    const r = splitState.results[Number(btn.dataset.idx)];
    triggerDownload(r.bytes, r.name);
  });
  
  splitDownloadAllBtn.addEventListener('click', async () => {
    const n = splitState.results.length;
    if (n === 0) return;
    if (n === 1){ triggerDownload(splitState.results[0].bytes, splitState.results[0].name); return; }
    splitDownloadAllBtn.disabled = true;
    const original = splitDownloadAllLabel.textContent;
    splitDownloadAllLabel.textContent = 'Menyiapkan ZIP…';
    try {
      const zip = new JSZip();
      splitState.results.forEach(r => zip.file(r.name, r.bytes));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = (splitState.file.name.replace(/\.pdf$/i, '') || 'pdf') + '-split.zip';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      splitDownloadAllBtn.disabled = false;
      splitDownloadAllLabel.textContent = original;
    }
  });
  
  splitResetBtn.addEventListener('click', resetSplit);
  
  function resetSplit(){
    splitState = { file: null, arrayBuffer: null, pageCount: 0, mode: 'each', results: [] };
    splitFileInput.value = '';
    splitDropzone.classList.remove('hidden');
    splitFileRow.classList.add('hidden');
    splitOptionsBlock.classList.add('hidden');
    splitRangeField.classList.add('hidden');
    splitRangeInput.value = '';
    [...splitModeSeg.children].forEach(b => b.classList.toggle('active', b.dataset.mode === 'each'));
    splitModeDesc.textContent = 'Setiap halaman akan menjadi file PDF terpisah.';
    splitProgressBlock.classList.add('hidden');
    clearSplitError();
    splitResultCard.classList.add('hidden');
    splitUploadCard.classList.remove('hidden');
  }
  
  /* ============================================================ */
  /* MERGE PDF                                                     */
  /* ============================================================ */
  const mergeDropzone = $('mergeDropzone'), mergeFileInput = $('mergeFileInput');
  const mergeListBlock = $('mergeListBlock'), mergeListCount = $('mergeListCount');
  const mergeFileList = $('mergeFileList'), mergeAddMoreBtn = $('mergeAddMoreBtn');
  const mergeBtn = $('mergeBtn'), mergeBtnLabel = $('mergeBtnLabel');
  const mergeProgressBlock = $('mergeProgressBlock'), mergeProgressFill = $('mergeProgressFill');
  const mergeProgressText = $('mergeProgressText'), mergeProgressPct = $('mergeProgressPct');
  const mergeErrorBox = $('mergeErrorBox'), mergeErrorText = $('mergeErrorText');
  const mergeUploadCard = $('mergeUploadCard'), mergeResultCard = $('mergeResultCard');
  const mergeResultSub = $('mergeResultSub'), mergeDownloadBtn = $('mergeDownloadBtn'), mergeResetBtn = $('mergeResetBtn');
  
  let mergeState = { items: [], resultBytes: null, resultName: '', totalPages: 0 };
  
  function showMergeError(msg){ mergeErrorText.textContent = msg; mergeErrorBox.classList.remove('hidden'); }
  function clearMergeError(){ mergeErrorBox.classList.add('hidden'); }
  function setMergeProgress(frac, label){
    const pct = Math.round(frac * 100);
    mergeProgressFill.style.width = pct + '%';
    mergeProgressPct.textContent = pct + '%';
    if (label) mergeProgressText.textContent = label;
  }
  
  function addMergeFiles(fileListRaw){
    clearMergeError();
    const files = Array.from(fileListRaw || []);
    if (files.length === 0) return;
    const rejected = [];
    files.forEach(file => {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf){ rejected.push(file.name); return; }
      mergeState.items.push({ id: ++uid, file });
    });
    if (rejected.length){
      showMergeError(`File berikut dilewati karena bukan PDF: ${rejected.join(', ')}`);
    }
    if (mergeState.items.length > 0){
      mergeDropzone.classList.add('hidden');
      mergeListBlock.classList.remove('hidden');
      renderMergeList();
    }
  }
  
  function renderMergeList(){
    mergeListCount.textContent = mergeState.items.length + ' file';
    mergeFileList.innerHTML = mergeState.items.map((item, idx) => `
      <div class="file-item" data-id="${item.id}">
        <div class="file-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6" stroke-linejoin="round"/></svg></div>
        <div class="file-meta">
          <div class="file-name">${idx + 1}. ${item.file.name}</div>
          <div class="file-status"><span>${formatBytes(item.file.size)}</span></div>
        </div>
        <div class="file-actions">
          <button class="icon-btn" data-action="up" data-id="${item.id}" title="Naik" ${idx === 0 ? 'disabled' : ''}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="icon-btn" data-action="down" data-id="${item.id}" title="Turun" ${idx === mergeState.items.length - 1 ? 'disabled' : ''}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="icon-btn" data-action="remove" data-id="${item.id}" title="Hapus"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg></button>
        </div>
      </div>`).join('');
    mergeBtnLabel.textContent = mergeState.items.length > 1 ? `Gabungkan ${mergeState.items.length} File` : 'Gabungkan PDF';
  }
  
  mergeFileList.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]'); if (!btn) return;
    const id = Number(btn.dataset.id);
    const idx = mergeState.items.findIndex(it => it.id === id);
    if (idx === -1) return;
    if (btn.dataset.action === 'remove'){
      mergeState.items.splice(idx, 1);
      if (mergeState.items.length === 0){ resetMerge(); } else { renderMergeList(); }
    } else if (btn.dataset.action === 'up' && idx > 0){
      [mergeState.items[idx - 1], mergeState.items[idx]] = [mergeState.items[idx], mergeState.items[idx - 1]];
      renderMergeList();
    } else if (btn.dataset.action === 'down' && idx < mergeState.items.length - 1){
      [mergeState.items[idx + 1], mergeState.items[idx]] = [mergeState.items[idx], mergeState.items[idx + 1]];
      renderMergeList();
    }
  });
  
  mergeDropzone.addEventListener('click', () => mergeFileInput.click());
  mergeAddMoreBtn.addEventListener('click', () => mergeFileInput.click());
  mergeFileInput.addEventListener('change', e => { addMergeFiles(e.target.files); mergeFileInput.value = ''; });
  ['dragenter','dragover'].forEach(evt => mergeDropzone.addEventListener(evt, e => { e.preventDefault(); mergeDropzone.classList.add('drag'); }));
  ['dragleave','drop'].forEach(evt => mergeDropzone.addEventListener(evt, e => { e.preventDefault(); mergeDropzone.classList.remove('drag'); }));
  mergeDropzone.addEventListener('drop', e => addMergeFiles(e.dataTransfer.files));
  
  mergeBtn.addEventListener('click', async () => {
    clearMergeError();
    if (mergeState.items.length < 2){
      showMergeError('Pilih minimal 2 file PDF untuk digabungkan.');
      return;
    }
    mergeListBlock.classList.add('hidden');
    mergeProgressBlock.classList.remove('hidden');
    mergeBtn.disabled = true;
    setMergeProgress(0, 'Memulai…');
  
    try {
      const outDoc = await PDFLib.PDFDocument.create();
      let totalPages = 0;
      for (let i = 0; i < mergeState.items.length; i++){
        const item = mergeState.items[i];
        const buf = await readAsArrayBuffer(item.file);
        const srcDoc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
        const indices = srcDoc.getPageIndices();
        const copied = await outDoc.copyPages(srcDoc, indices);
        copied.forEach(p => outDoc.addPage(p));
        totalPages += indices.length;
        setMergeProgress((i + 1) / mergeState.items.length, `Menggabungkan file ${i + 1} dari ${mergeState.items.length}: ${item.file.name}`);
      }
      const bytes = await outDoc.save({ useObjectStreams: false });
      mergeState.resultBytes = bytes;
      mergeState.resultName = 'gabungan.pdf';
      mergeState.totalPages = totalPages;
      showMergeResult();
    } catch (e){
      console.error(e);
      mergeProgressBlock.classList.add('hidden');
      mergeListBlock.classList.remove('hidden');
      showMergeError('Gagal menggabungkan PDF. Pastikan semua file valid dan tidak terkunci kata sandi.');
    } finally {
      mergeBtn.disabled = false;
    }
  });
  
  function showMergeResult(){
    mergeResultSub.textContent = `${mergeState.items.length} file digabung · ${mergeState.totalPages} halaman · ${formatBytes(mergeState.resultBytes.byteLength)}`;
    mergeUploadCard.classList.add('hidden');
    mergeProgressBlock.classList.add('hidden');
    mergeResultCard.classList.remove('hidden');
  }
  
  mergeDownloadBtn.addEventListener('click', () => {
    if (!mergeState.resultBytes) return;
    triggerDownload(mergeState.resultBytes, mergeState.resultName);
  });
  
  mergeResetBtn.addEventListener('click', resetMerge);
  
  function resetMerge(){
    mergeState = { items: [], resultBytes: null, resultName: '', totalPages: 0 };
    mergeFileInput.value = '';
    mergeDropzone.classList.remove('hidden');
    mergeListBlock.classList.add('hidden');
    mergeFileList.innerHTML = '';
    mergeProgressBlock.classList.add('hidden');
    clearMergeError();
    mergeResultCard.classList.add('hidden');
    mergeUploadCard.classList.remove('hidden');
  }
}

export function unmount() {
  // No document/window-level listeners were attached (see map.md notes on
  // this page) — everything lived inside `container`, so the router's
  // container.innerHTML = '' already tears it all down. Only undo what we
  // set on the container itself:
  mountedContainer?.classList.remove('wrap');
  mountedContainer = null;
}
