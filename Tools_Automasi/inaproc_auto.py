#!/usr/bin/env python3
"""
INAPROC Auto Isi Master Produk Sectoral (Alkes - Kode Unik KFA) -- Python port.

Ladder taken vs the userscript:
- Playwright's built-in auto-waiting replaces the hand-rolled MutationObserver /
  pollUntil / waitForClickableByText helpers -- that's what Playwright locators
  already do.
- A TSV queue file + CSV results file + CLI flags replace the injected HTML
  panel (drag, collapse, clipboard-copy, live counters). A desktop script
  doesn't need a page-injected UI to take input; run it again for the next
  batch.
- Login/dashboard navigation is NOT automated -- you log in and get to the
  dashboard yourself in the opened browser, then hit Enter. Scripting login is
  scope creep until you actually need unattended runs.
- The "Kategori" dropdown control is grabbed as the last visible
  select__control after ticking Sectoral (same assumption the JS made via its
  before/after Set diff, just simpler). ponytail: assumes Sectoral's dropdown
  is always the last one to appear -- if INAPROC adds another dropdown above it
  later, switch back to a before/after snapshot diff like the original.

Requires: pip install playwright && playwright install chromium

Usage:
    python inaproc_auto.py queue.tsv --results hasil.csv           # dry run
    python inaproc_auto.py queue.tsv --results hasil.csv --live    # real submit
    python inaproc_auto.py --selftest                              # no browser needed
"""
import argparse
import csv
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

SUPABASE_BASE_URL = "https://ptkkbsemihcyndisjoor.supabase.co/storage/v1/object/public/perizinan"
SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0a2ti"
    "c2VtaWhjeW5kaXNqb29yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0Njc4MzgsImV4cCI6MjA5"
    "ODA0MzgzOH0.QsCqmcqQcXvz1f8bLkagvMbAGUBbBP-3Wa5Aore5OMo"
)
CPAKB_PATH = "Sertifikat CPAKB PNM KBLI 32509 K1.pdf"
KATEGORI_LABEL = "Kategori Alkes: Kode Unik KFA"
BASE_URL = "https://penyedia.inaproc.id/"


@dataclass
class QueueItem:
    kfa_code: str
    akd_path: str


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def read_queue(path: str) -> list[QueueItem]:
    items = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if len(row) >= 2 and row[0].strip() and row[1].strip():
                items.append(QueueItem(row[0].strip(), row[1].strip()))
    return items


def write_result(results_path: str, kfa_code: str, status: str) -> None:
    is_new = not Path(results_path).exists()
    with open(results_path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if is_new:
            w.writerow(["KODE_KFA", "STATUS", "TIMESTAMP"])
        w.writerow([kfa_code, status, datetime.now().isoformat()])


def fetch_to_tempfile(path: str) -> str:
    """Download from Supabase Storage to a local temp file -- Playwright's
    set_input_files needs a real path, not bytes."""
    encoded = "/".join(urllib.parse.quote(seg) for seg in path.split("/"))
    url = f"{SUPABASE_BASE_URL}/{encoded}"
    req = urllib.request.Request(
        url,
        headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {SUPABASE_ANON_KEY}"},
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise RuntimeError(f"Gagal ambil file ({resp.status}) di {url}")
        data = resp.read()
    suffix = Path(path).suffix or ".pdf"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.write(data)
    tmp.close()
    return tmp.name


def dokumen_input(page, nomor: int):
    """Slot dicari via header unik 'Dokumen N' -- teks dropzone identik di semua
    slot jadi gak bisa dipakai buat bedain, sama seperti versi JS."""
    header = page.locator(f"text=Dokumen {nomor}").first
    header.wait_for(state="visible", timeout=10000)
    container = header.locator("xpath=ancestor::*[.//input[@type='file']]").first
    return container.locator("input[type=file]").first, container


def tunggu_lihat_dokumen(container, label: str, timeout_ms: int = 20000) -> None:
    links = container.locator("a:text-is('Lihat Dokumen')")
    existing = {links.nth(i).get_attribute("href") for i in range(links.count())}
    log(f"⏳ Menunggu upload {label} selesai...")
    start = time.time()
    while (time.time() - start) * 1000 < timeout_ms:
        for i in range(links.count()):
            href = links.nth(i).get_attribute("href")
            if href and href not in existing and links.nth(i).is_visible():
                log(f"✅ Upload {label} selesai (link baru terdeteksi).")
                time.sleep(0.3)
                return
        time.sleep(0.3)
    raise TimeoutError(f"Upload {label} tidak selesai dalam {timeout_ms / 1000:.0f} detik.")


def error_nomor_permohonan(page) -> bool:
    loc = page.locator("text=Nomor permohonan wajib").first
    return loc.count() > 0 and loc.is_visible()


def pilih_kategori(page) -> None:
    control = page.locator("[class*='select__control']").last
    control.click()
    option = page.locator("[class*='select__option']", has_text=KATEGORI_LABEL).first
    option.wait_for(state="visible", timeout=8000)
    option.click()
    page.wait_for_timeout(600)


def proses_satu_sku(page, item: QueueItem, dry_run: bool) -> str:
    page.locator("#sectoral").check()
    pilih_kategori(page)

    kfa_input = page.locator("input[name='kfa.input'], input[placeholder='Nomor Produk']").first
    kfa_input.fill(item.kfa_code)
    page.locator("#find-kfa-button").click()
    page.wait_for_timeout(3500)

    # 1 percobaan per page-load -- error di sini -> caller reload (fresh start).
    if error_nomor_permohonan(page):
        return "skipped-kfa-bermasalah"

    page.locator("input[label='Pemilik Merek']").check()
    page.locator("input[label='Produsen']").check()

    akd_input, akd_container = dokumen_input(page, 1)
    akd_input.set_input_files(fetch_to_tempfile(item.akd_path))
    tunggu_lihat_dokumen(akd_container, "Dokumen 1 (AKD)")

    cpakb_input, cpakb_container = dokumen_input(page, 2)
    cpakb_input.set_input_files(fetch_to_tempfile(CPAKB_PATH))
    tunggu_lihat_dokumen(cpakb_container, "Dokumen 2 (CPAKB)")

    if error_nomor_permohonan(page):
        return "skipped-kfa-bermasalah-late"

    if dry_run:
        log(f"[DRY RUN] KFA '{item.kfa_code}' selesai diisi, Kirim TIDAK diklik.")
        return "dry-run"

    page.locator("#checkbox-data-validity-confirmation").check()
    kirim = page.locator("button:has(span:text-is('Kirim'))").first
    try:
        kirim.click(timeout=8000)
    except Exception:
        return "skipped-kirim-timeout"
    try:
        kirim.wait_for(state="detached", timeout=15000)
    except Exception:
        raise RuntimeError("Tombol 'Kirim' masih ada setelah 15 detik -- submit kemungkinan nyangkut.")
    return "submitted"


def kembali_dan_daftarkan_lagi(page) -> None:
    page.locator("button:has(span:text-is('Kembali ke Dashboard'))").click(timeout=15000)
    page.locator("button:has(span:text-is('Daftarkan Merek'))").click(timeout=15000)


def run(queue_path: str, results_path: str, dry_run: bool, profile_dir: str, headless: bool) -> None:
    from playwright.sync_api import sync_playwright  # import here so --selftest needs no browser

    items = read_queue(queue_path)
    if not items:
        log("Antrian kosong, keluar.")
        return
    log(f"Antrian dimuat: {len(items)} SKU.")

    with sync_playwright() as p:
        # ponytail: pakai Chrome asli (channel="chrome") + matiin flag automation --
        # Chromium bundled Playwright gampang kedeteksi jadi bot (navigator.webdriver),
        # yang bikin tombol login/captcha situs diam-diam disable/gagal.
        ctx = p.chromium.launch_persistent_context(
            profile_dir,
            headless=headless,
            channel="chrome",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.new_page()
        page.goto(BASE_URL)

        input("Login & arahkan ke dashboard yang ada tombol 'Daftarkan Merek', lalu tekan Enter...")
        page.locator("button:has(span:text-is('Daftarkan Merek'))").click(timeout=15000)

        for i, item in enumerate(items):
            log(f"--- SKU {i + 1}/{len(items)}: {item.kfa_code} ---")
            try:
                status = proses_satu_sku(page, item, dry_run)
            except Exception as exc:
                log(f"⚠️ Gagal memproses '{item.kfa_code}': {exc}")
                status = "error"
            write_result(results_path, item.kfa_code, status)

            if i == len(items) - 1:
                break
            if status == "submitted":
                kembali_dan_daftarkan_lagi(page)
            else:  # skipped-*, error, dry-run -- fresh start, same as the userscript
                log("🔄 Refresh buat fresh start...")
                page.reload()
                page.locator("#sectoral").wait_for(state="visible", timeout=15000)

        log("🎉 Selesai.")
        ctx.close()


def _selftest() -> None:
    """python inaproc_auto.py --selftest -- pure-function check, no browser needed."""
    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False, encoding="utf-8") as f:
        f.write("KFA001\tpath/to/akd1.pdf\n\nKFA002\tpath/to/akd2.pdf\nbad_line_no_tab\n")
        f.flush()
        items = read_queue(f.name)
    assert items == [
        QueueItem("KFA001", "path/to/akd1.pdf"),
        QueueItem("KFA002", "path/to/akd2.pdf"),
    ], f"read_queue mismatch: {items}"
    print("selftest OK")


def main() -> None:
    if "--selftest" in sys.argv:
        _selftest()
        return
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("queue", help="File TSV: KODE_KFA<TAB>PATH_FILE_AKD per baris")
    ap.add_argument("--results", default="inaproc_hasil.csv")
    ap.add_argument("--profile-dir", default="./inaproc-profile", help="Persistent browser profile (nyimpen login)")
    ap.add_argument("--live", action="store_true", help="Matiin dry-run -- BENERAN submit ke INAPROC")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()
    run(args.queue, args.results, dry_run=not args.live, profile_dir=args.profile_dir, headless=args.headless)


if __name__ == "__main__":
    main()
