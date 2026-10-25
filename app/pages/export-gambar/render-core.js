// export-gambar / render-core.js
// Logika render thumbnail gabungan (template brand + gambar produk) yang dipakai BERSAMA oleh:
//   - export-gambar/index.js   (mode satuan + tab Bulk)
//   - uploader-wiki/bundle.js  (folder THUMBNAILS di paket upload INAPROC)
// Satu sumber kebenaran: hasil paket upload = hasil Export Gambar, piksel per piksel.
// Isi fungsi dipindah APA ADANYA dari index.js (sebelumnya di dalam mount()); tidak ada perubahan perilaku.
// Hanya bergantung pada DOM (document / Image), tidak pada state halaman mana pun.

export const THUMBNAILS_BUCKET = "thumbnails";

// Template per brand. `file` = nama file di bucket "thumbnails" (private, diambil via signed URL).
// `box` = area kotak putih di template (fraksi 0..1 dari lebar/tinggi kanvas) tempat gambar produk disusun.
//  - robust: hasil pengukuran piksel kotak putih (persegi panjang).
//  - adler : kotak putihnya jajargenjang miring, jadi `box` = persegi panjang terbesar yang muat DI DALAM
//    jajargenjang itu (x 220-858, y 295-785 dari 1080px) supaya gambar gak keluar dari tepi miring.
export const TEMPLATES = {
  robust: {
    label: "Robust",
    file: "TEMPLATE_THUMBNAIL_ROBUST.png",
    box: { xStart: 0.1664, xEnd: 0.8620, yStart: 0.2199, yEnd: 0.6523 },
  },
  adler: {
    label: "Adler",
    file: "TEMPLATE_THUMBNAIL_ADLER.png",
    box: { xStart: 0.2037, xEnd: 0.7944, yStart: 0.2731, yEnd: 0.7269 },
  },
};

export function loadImage(src) {
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

// Load gambar dengan retry + exponential backoff, khusus menangani 429
export function loadImageWithRetry(src, maxRetries = 4, baseDelay = 800) {
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

// Memotong ruang kosong/transparan di sekeliling objek, supaya saat di-fit ke sel
// grid, objeknya mengisi ruang secara maksimal (bukan ikut ruang kosong di sekitarnya).
export function trimTransparentEdges(canvas) {
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

export async function removeBackgroundHighQuality(image) {
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

// Menyusun 1–4 overlay dalam grid, DI DALAM kotak putih template (koordinat
// diukur langsung dari template: x 16.6%–86.2%, y 22%–65.2% dari kanvas).
// Zona ini tetap sama untuk semua jumlah gambar — hanya grid di dalamnya yang berubah.
// targetCanvas WAJIB di sini (index.js membungkusnya dengan fallback ke kanvas preview).
export function drawMergedCanvas(templateImg, overlayCanvases, BOX, targetCanvas) {
  let canvas = targetCanvas;
  let ctx = canvas.getContext("2d");
  canvas.width = templateImg.width;
  canvas.height = templateImg.height;
  ctx.drawImage(templateImg, 0, 0, canvas.width, canvas.height);

  const count = overlayCanvases.length;

  // Batas area gambar ikut template yang dipilih (lihat TEMPLATES di atas).
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

// Satu produk -> satu thumbnail PNG (Blob), persis alur satu baris di tab Bulk:
// hapus background putih -> susun di kotak template -> PNG. Kanvas dibebaskan setelahnya.
export async function renderThumbnailBlob(templateImg, productImg, box) {
  const overlay = await removeBackgroundHighQuality(productImg);
  const canvas = document.createElement("canvas");
  drawMergedCanvas(templateImg, [overlay], box, canvas);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  canvas.width = canvas.height = 0; // bebaskan memori
  if (!blob) throw new Error("gagal membuat PNG");
  return blob;
}

// Nama file keluaran: sama dengan safeName() di bulk-thumb.js (nama file = kode_asli).
export function thumbFileName(kodeAsli) {
  const base = String(kodeAsli).normalize("NFKC").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "thumbnail";
  return base + ".png";
}