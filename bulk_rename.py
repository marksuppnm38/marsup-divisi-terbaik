"""
Bulk rename script: konversi nama file kode asli menjadi format kode RB baru.

Aturan konversi:
1) Format dengan tanda hubung, contoh:  "15-251-03-07.png"
   -> "RB15-KE251-B003-U07.png"
   (segmen1 -> RB+segmen1, segmen2 -> KE+segmen2,
    segmen3 -> B0+segmen3, segmen4 -> U+segmen4)

2) Format alfanumerik tanpa tanda hubung, contoh: "MA304R.png"
   -> "RBM-KEA-B030-U4R.png"
   (char ke-1 -> RB+char1, char ke-2 -> KE+char2,
    char ke 3-4 -> B0+2char, sisa karakter -> U+sisa)

File yang TIDAK cocok kedua pola di atas akan dicatat di
'tidak_dikenali.csv' dan TIDAK diubah — supaya aman untuk direview manual.

CARA PAKAI (Windows / cmd / PowerShell):
    python bulk_rename.py "C:\\path\\ke\\folder\\gambar"
        -> hanya PREVIEW, tidak ada file yang diubah, cek rename_log.csv dulu

    python bulk_rename.py "C:\\path\\ke\\folder\\gambar" --apply
        -> benar-benar melakukan rename setelah preview dicek dan oke
"""

import argparse
import csv
import re
from pathlib import Path

PATTERN_DASH = re.compile(r'^(\d+)-(\d+)-(\d+)-(\d+)$')
PATTERN_ALNUM = re.compile(r'^[A-Za-z0-9]{4,}$')

KNOWN_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp'}


def strip_repeated_extension(filename: str):
    """
    Buang ekstensi yang keulang (misal 'xxx.png.png' -> stem='xxx', ext='.png').
    Kalau cuma ada satu ekstensi biasa, hasilnya sama seperti Path.stem/.suffix biasa.
    """
    stem = filename
    ext = ""
    while True:
        p = Path(stem)
        if p.suffix.lower() in KNOWN_EXTS:
            ext = p.suffix
            stem = p.stem
        else:
            break
    return stem, ext


def build_new_name(stem: str):
    """Kembalikan nama baru (tanpa ekstensi) sesuai pola, atau None kalau tidak cocok."""
    m = PATTERN_DASH.match(stem)
    if m:
        g1, g2, g3, g4 = m.groups()
        return f"RB{g1}-KE{g2}-B0{g3}-U{g4}"

    if PATTERN_ALNUM.match(stem):
        p1 = stem[0]
        p2 = stem[1]
        p3 = stem[2:4]
        p4 = stem[4:]
        return f"RB{p1}-KE{p2}-B0{p3}-U{p4}"

    return None


def main():
    parser = argparse.ArgumentParser(description="Bulk rename file gambar ke format kode RB.")
    parser.add_argument("source_dir", help="Folder berisi file-file gambar yang mau di-rename")
    parser.add_argument(
        "--apply", action="store_true",
        help="Benar-benar rename file. Tanpa flag ini, script hanya PREVIEW (dry-run)."
    )
    parser.add_argument(
        "--log", default="rename_log.csv",
        help="Path file CSV log hasil rename (default: rename_log.csv)"
    )
    args = parser.parse_args()

    source = Path(args.source_dir)
    if not source.is_dir():
        print(f"Folder tidak ditemukan: {source}")
        return

    files = sorted([f for f in source.iterdir() if f.is_file()])
    print(f"Ditemukan {len(files)} file di folder.")

    log_rows = []
    unmatched = []
    seen_new_names = set()
    conflict_count = 0

    for f in files:
        stem, ext = strip_repeated_extension(f.name)  # otomatis handle .png.png -> .png

        new_stem = build_new_name(stem)

        if new_stem is None:
            unmatched.append(f.name)
            continue

        new_name = f"{new_stem}{ext}"

        # cek tabrakan nama baru (hindari file ketimpa)
        if new_name in seen_new_names:
            conflict_count += 1
            counter = 2
            while new_name in seen_new_names:
                new_name = f"{new_stem}_dup{counter}{ext}"
                counter += 1
        seen_new_names.add(new_name)

        log_rows.append({"nama_lama": f.name, "nama_baru": new_name})

        if args.apply:
            target = f.parent / new_name
            f.rename(target)

    # simpan log hasil mapping
    try:
        with open(args.log, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=["nama_lama", "nama_baru"])
            writer.writeheader()
            writer.writerows(log_rows)
    except PermissionError:
        alt_log = args.log.replace(".csv", "_baru.csv")
        print(f"[!] Tidak bisa menulis ke {args.log} (kemungkinan sedang terbuka di Excel/program lain).")
        print(f"    Menyimpan ke nama alternatif: {alt_log}")
        with open(alt_log, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=["nama_lama", "nama_baru"])
            writer.writeheader()
            writer.writerows(log_rows)
        args.log = alt_log

    # simpan log file yang tidak cocok pola (kalau ada)
    if unmatched:
        unmatched_log = "tidak_dikenali.csv"
        try:
            with open(unmatched_log, "w", newline="", encoding="utf-8") as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(["nama_file"])
                for name in unmatched:
                    writer.writerow([name])
        except PermissionError:
            unmatched_log = "tidak_dikenali_baru.csv"
            print(f"[!] Tidak bisa menulis ke tidak_dikenali.csv (kemungkinan sedang terbuka di Excel/program lain).")
            print(f"    Menyimpan ke nama alternatif: {unmatched_log}")
            with open(unmatched_log, "w", newline="", encoding="utf-8") as csvfile:
                writer = csv.writer(csvfile)
                writer.writerow(["nama_file"])
                for name in unmatched:
                    writer.writerow([name])
        print(f"\n[!] {len(unmatched)} file TIDAK cocok pola, tidak diubah. Lihat: {unmatched_log}")

    print(f"\nTotal berhasil dipetakan: {len(log_rows)} file")
    if conflict_count:
        print(f"[!] {conflict_count} nama baru bentrok, otomatis ditambah suffix _dup2, _dup3, dst.")
    print(f"Log lengkap disimpan di: {args.log}")

    if not args.apply:
        print("\n=== INI BARU PREVIEW (dry-run). Tidak ada file yang benar-benar diubah. ===")
        print("Cek dulu isi", args.log, "-- kalau sudah benar semua, jalankan lagi dengan tambahan --apply")
    else:
        print("\n=== Rename selesai dijalankan. ===")


if __name__ == "__main__":
    main()