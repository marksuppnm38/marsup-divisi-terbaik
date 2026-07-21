"""
Batch merge images: mengambil daftar file dari Google Sheets, mendownload
gambar overlay dari Google Drive, menghapus background putih, menggabungkan
dengan gambar template, lalu menyimpan tiap hasil sebagai PNG.

Ini adalah versi Python dari logika di file HTML (html2canvas + <canvas>),
supaya bisa memproses SEMUA baris sekaligus tanpa klik satu-satu di browser.

Install dependency dulu:
    pip install pillow requests
"""

import io
import os
import re
import time

import requests
from PIL import Image

# ====== KONFIGURASI (samakan dengan file HTML kamu) ======
SHEET_ID = "1ORz0OUqzKSZI56lUaZV5i7ZPRCYuFSYBP7QF4pn4-e8"
RANGE = "Sheet1!A:Z"
API_KEY = "AIzaSyB1LxflUKkZLISYa8Eyd6CVuxweaPuH8ko"  # ganti/rotasi kalau perlu

TEMPLATE_FILE_ID = "1uZiM5HO748yItSjYS17OgCmw71uK5xPN"
TEMPLATE_URL = f"https://lh3.googleusercontent.com/d/{TEMPLATE_FILE_ID}"

OUTPUT_DIR = "output_images"
WHITE_THRESHOLD = 240  # sama seperti di JS: pixel > 240 dianggap putih -> transparan

# Posisi & ukuran overlay relatif terhadap template (disamakan dengan JS)
OVERLAY_WIDTH_RATIO = 0.43
OVERLAY_X_RATIO = 0.5
OVERLAY_X_OFFSET_RATIO = 0.45  # dikurangkan: overlayWidth * 0.45
OVERLAY_Y_RATIO = 0.4
OVERLAY_Y_OFFSET_RATIO = 0.45  # dikurangkan: overlayHeight * 0.45


def drive_image_url(file_id: str) -> str:
    """Sama seperti getDriveImageUrl() di JS."""
    return f"https://lh3.googleusercontent.com/d/{file_id}"


def sanitize_filename(name: str) -> str:
    name = name.strip() or "untitled"
    return re.sub(r'[\\/*?:"<>|]', "_", name)


def fetch_sheet_rows():
    """Ambil semua baris dari Google Sheets, sama seperti loadFileList()."""
    url = (
        f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}"
        f"/values/{RANGE}?key={API_KEY}"
    )
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    rows = data.get("values", [])
    print(f"[INFO] {len(rows)} baris ditemukan di Google Sheets.")
    return rows


def download_image(url: str) -> Image.Image:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGBA")
    return img


def remove_white_background(img: Image.Image, threshold: int = WHITE_THRESHOLD) -> Image.Image:
    """Sama seperti removeBackgroundHighQuality() di JS: piksel hampir-putih -> transparan."""
    img = img.convert("RGBA")
    pixels = img.load()
    width, height = img.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if r > threshold and g > threshold and b > threshold:
                pixels[x, y] = (r, g, b, 0)
    return img


def merge_images(template: Image.Image, overlay: Image.Image) -> Image.Image:
    """Sama seperti drawMergedCanvas() di JS."""
    canvas = template.convert("RGBA").copy()
    canvas_w, canvas_h = canvas.size

    overlay_w = int(canvas_w * OVERLAY_WIDTH_RATIO)
    overlay_h = int(overlay_w * (overlay.height / overlay.width))
    overlay_resized = overlay.resize((overlay_w, overlay_h), Image.LANCZOS)

    overlay_x = int((canvas_w * OVERLAY_X_RATIO) - (overlay_w * OVERLAY_X_OFFSET_RATIO))
    overlay_y = int((canvas_h * OVERLAY_Y_RATIO) - (overlay_h * OVERLAY_Y_OFFSET_RATIO))

    canvas.paste(overlay_resized, (overlay_x, overlay_y), overlay_resized)
    return canvas


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    rows = fetch_sheet_rows()
    if not rows:
        print("[ERROR] Tidak ada data di Google Sheets.")
        return

    print(f"[INFO] Mengunduh template: {TEMPLATE_URL}")
    template_img = download_image(TEMPLATE_URL)

    # Lewati header kalau baris pertama bukan data (opsional, sesuaikan kalau sheet kamu punya header)
    # rows = rows[1:]

    success, failed = 0, 0
    for i, row in enumerate(rows, start=1):
        if len(row) < 4 or not row[3]:
            print(f"[SKIP] Baris {i}: kolom File ID (D) kosong.")
            continue

        name = row[0] if len(row) > 0 else f"file_{i}"
        file_id = row[3]

        try:
            print(f"[INFO] ({i}/{len(rows)}) Memproses '{name}' (fileId={file_id})...")
            overlay_url = drive_image_url(file_id)
            overlay_img = download_image(overlay_url)
            overlay_processed = remove_white_background(overlay_img)
            merged = merge_images(template_img, overlay_processed)

            out_path = os.path.join(OUTPUT_DIR, f"{sanitize_filename(name)}.png")
            merged.save(out_path, "PNG")
            print(f"[SUCCESS] Disimpan: {out_path}")
            success += 1

            time.sleep(0.3)  # jeda kecil biar tidak membanjiri request
        except Exception as e:
            print(f"[ERROR] Gagal memproses '{name}' (fileId={file_id}): {e}")
            failed += 1

    print(f"\n[SELESAI] Berhasil: {success}, Gagal: {failed}")
    print(f"Semua hasil ada di folder: {os.path.abspath(OUTPUT_DIR)}")


if __name__ == "__main__":
    main()