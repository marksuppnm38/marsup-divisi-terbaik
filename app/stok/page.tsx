"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ExcelJS from "exceljs";
import {
  clearAuthSession,
  loginWithPassword,
  resolveAccessToken,
  saveAuthSession,
} from "@/lib/auth-session";
import { restGet, restInsert, restRpc } from "@/lib/supabase-rest";
import "./stok.css";

const HISTORY_KEY = "pnm_stok_upload_history";

type ParsedRow = { kode_asli: string; qty: number };
type HistoryEntry = {
  id?: number | string;
  at: string;
  email: string | null;
  fileName: string | null;
  total: number;
  skipped: number;
  skippedCodes?: string[];
};

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
  };
}
function initials(email: string | null) {
  if (!email) return "?";
  return email.trim()[0].toUpperCase();
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}
function readLocalHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function pushLocalHistory(entry: HistoryEntry) {
  const hist = readLocalHistory();
  hist.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 30)));
}

export default function StokPage() {
  // ---- theme ----
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pnm_theme") as "light" | "dark" | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage, a real external system
      setTheme(stored);
    } catch {}
  }, []);
  const effectiveTheme =
    theme ||
    (typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark");
  function toggleTheme() {
    const next = effectiveTheme === "light" ? "dark" : "light";
    try {
      localStorage.setItem("pnm_theme", next);
    } catch {}
    setTheme(next);
  }

  // ---- auth ----
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [gateEmail, setGateEmail] = useState("");
  const [gatePassword, setGatePassword] = useState("");
  const [gateStatus, setGateStatus] = useState("");
  const [gateBusy, setGateBusy] = useState(false);

  const initAuth = useCallback(async () => {
    const { token, email: em, expiredMessage } = await resolveAccessToken();
    setAccessToken(token);
    setEmail(em);
    if (expiredMessage) setGateStatus(expiredMessage);
    setAuthReady(true);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resolving/refreshing the session against Supabase auth on mount
    initAuth();
  }, [initAuth]);

  async function handleLogin() {
    const emailVal = gateEmail.trim().toLowerCase();
    if (!emailVal || !gatePassword) {
      setGateStatus("Isi email dan password dulu.");
      return;
    }
    setGateBusy(true);
    setGateStatus("");
    try {
      const data = await loginWithPassword(emailVal, gatePassword);
      saveAuthSession(data);
      setAccessToken(data.access_token);
      setEmail(emailVal);
      setGatePassword("");
    } catch (err) {
      setGateStatus("Gagal masuk: " + (err as Error).message);
    } finally {
      setGateBusy(false);
    }
  }
  function handleLogout() {
    clearAuthSession();
    setAccessToken(null);
    setEmail(null);
  }

  // ---- shared history ----
  const [sharedHistoryAvailable, setSharedHistoryAvailable] = useState<
    boolean | null
  >(null);
  const [historyShowAll, setHistoryShowAll] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  const getHistory = useCallback(
    async (limit: number): Promise<HistoryEntry[]> => {
      if (!accessToken) return [];
      try {
        const rows = await restGet<
          {
            id: number;
            email: string;
            uploaded_at: string;
            total_rows: number;
            skipped_count: number;
            file_name: string | null;
          }[]
        >(
          "stok_upload_log",
          `select=id,email,uploaded_at,total_rows,skipped_count,file_name&order=uploaded_at.desc&limit=${limit}`,
          accessToken
        );
        setSharedHistoryAvailable(true);
        return rows.map((r) => ({
          id: r.id,
          at: r.uploaded_at,
          email: r.email,
          total: r.total_rows,
          skipped: r.skipped_count,
          fileName: r.file_name,
        }));
      } catch {
        setSharedHistoryAvailable(false);
        return readLocalHistory().slice(0, limit);
      }
    },
    [accessToken]
  );

  const refreshHistory = useCallback(async () => {
    setHistoryBusy(true);
    try {
      const hist = await getHistory(historyShowAll ? 30 : 10);
      setHistory(hist);
    } finally {
      setHistoryBusy(false);
    }
  }, [getHistory, historyShowAll]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching shared history from Supabase whenever auth becomes available
    if (accessToken) refreshHistory();
  }, [accessToken, refreshHistory]);

  async function recordUpload(entry: HistoryEntry) {
    if (!accessToken) return;
    try {
      await restInsert(
        "stok_upload_log",
        {
          email: entry.email,
          uploaded_at: entry.at,
          file_name: entry.fileName || null,
          total_rows: entry.total,
          skipped_count: entry.skipped,
          skipped_codes: (entry.skippedCodes || []).slice(0, 500),
        },
        accessToken
      );
      setSharedHistoryAvailable(true);
    } catch {
      setSharedHistoryAvailable(false);
      pushLocalHistory(entry);
    }
  }

  async function downloadSkippedForRow(id: number | string) {
    if (!accessToken) return;
    try {
      const rows = await restGet<{ skipped_codes: string[] }[]>(
        "stok_upload_log",
        `select=skipped_codes&id=eq.${id}`,
        accessToken
      );
      const codes = rows[0]?.skipped_codes || [];
      downloadCsv(`stok-dilewati-log-${id}.csv`, ["kode_asli", ...codes].join("\n"));
    } catch {}
  }

  function downloadCsv(filename: string, csv: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- file upload / precheck ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [currentFileSize, setCurrentFileSize] = useState<number | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [matchedRows, setMatchedRows] = useState<ParsedRow[] | null>(null);
  const [skippedRows, setSkippedRows] = useState<ParsedRow[] | null>(null);
  const [dupCount, setDupCount] = useState(0);
  const [checkingText, setCheckingText] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [skipSearch, setSkipSearch] = useState("");
  const [statusMsg, setStatusMsg] = useState<{
    kind: "ok" | "err" | "fail";
    text: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  function resetUploadUI() {
    setParsedRows(null);
    setMatchedRows(null);
    setSkippedRows(null);
    setCurrentFileName(null);
    setCurrentFileSize(null);
    setDupCount(0);
    setCheckingText(null);
    setProgress(0);
    setStatusMsg(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function fetchValidKodeSet(kodeList: string[]): Promise<Set<string>> {
    const valid = new Set<string>();
    if (!accessToken) return valid;
    const CHUNK = 150;
    const chunks: string[][] = [];
    for (let i = 0; i < kodeList.length; i += CHUNK) {
      chunks.push(kodeList.slice(i, i + CHUNK));
    }
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const inList = chunk
        .map((k) => `"${k.replace(/"/g, '\\"')}"`)
        .join(",");
      try {
        const rows = await restGet<{ kode_asli: string }[]>(
          "master_produk",
          `select=kode_asli&kode_asli=in.(${inList})`,
          accessToken
        );
        rows.forEach((d) => valid.add(d.kode_asli));
      } catch {
        // ignore chunk failure, keep going
      }
      setProgress(Math.round(((i + 1) / chunks.length) * 100));
    }
    return valid;
  }

  async function runPrecheck(rows: ParsedRow[]) {
    setCheckingText(`Memeriksa ${rows.length.toLocaleString("id-ID")} kode ke database produk…`);
    setProgress(0);
    try {
      const validSet = await fetchValidKodeSet(rows.map((r) => r.kode_asli));
      setMatchedRows(rows.filter((r) => validSet.has(r.kode_asli)));
      setSkippedRows(rows.filter((r) => !validSet.has(r.kode_asli)));
    } catch (err) {
      setStatusMsg({
        kind: "fail",
        text: `Gagal memeriksa database: ${(err as Error).message} — kamu tetap bisa upload, tapi laporan "dilewati" baru muncul setelah proses selesai.`,
      });
    } finally {
      setCheckingText(null);
      setProgress(0);
    }
  }

  async function handleFile(file: File) {
    resetUploadUI();
    setCurrentFileName(file.name);
    setCurrentFileSize(file.size);
    setCheckingText("Membaca file…");
    try {
      const buffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const ws = wb.worksheets[0];
      const headerRow = ws.getRow(1);
      let colKode: number | null = null;
      let colQty: number | null = null;
      headerRow.eachCell((cell, colNumber) => {
        const v = String(cell.value || "").trim().toUpperCase();
        if (v === "KODEASLI" || v === "KODE ASLI") colKode = colNumber;
        if (v === "QTY") colQty = colNumber;
      });
      if (!colKode || !colQty) {
        throw new Error(
          "Kolom KODEASLI dan/atau QTY tidak ditemukan di baris pertama file."
        );
      }
      const seen = new Map<string, ParsedRow>();
      let dups = 0;
      for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const kodeAsli = String(row.getCell(colKode).value || "").trim();
        const qtyRaw = row.getCell(colQty).value;
        const qty = parseInt(String(qtyRaw), 10);
        if (!kodeAsli) continue;
        if (seen.has(kodeAsli)) dups++;
        seen.set(kodeAsli, { kode_asli: kodeAsli, qty: isNaN(qty) ? 0 : qty });
      }
      const rows = [...seen.values()];
      if (rows.length === 0) {
        throw new Error("Tidak ada baris data yang valid di file ini.");
      }
      setParsedRows(rows);
      setDupCount(dups);
      await runPrecheck(rows);
    } catch (err) {
      setCheckingText(null);
      setStatusMsg({ kind: "fail", text: `Gagal baca file: ${(err as Error).message}` });
    }
  }

  async function handleUploadClick() {
    if (!parsedRows || !accessToken) return;
    const skipNote =
      skippedRows && skippedRows.length > 0
        ? `${skippedRows.length} kode akan DILEWATI karena belum terdaftar sebagai produk.\n\n`
        : "";
    if (
      !confirm(
        `${skipNote}Yakin timpa seluruh data stok dengan ${parsedRows.length} baris dari file ini?`
      )
    ) {
      return;
    }
    setUploading(true);
    setStatusMsg(null);
    try {
      const res = await restRpc(
        "replace_stok_produk",
        { rows: parsedRows },
        accessToken
      );
      if (res.status === 401) {
        setGateStatus("Sesi kamu habis, silakan masuk lagi.");
        handleLogout();
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          errData.message ||
            errData.hint ||
            "Gagal upload stok (cek apakah email kamu terdaftar di allowed_users)"
        );
      }
      const result = await res.json();
      const serverSkippedCount = result.skipped_count || 0;
      const serverSkippedCodes: string[] = result.skipped_codes || [];
      let msg = `Berhasil! ${result.inserted.toLocaleString("id-ID")} kode stok diperbarui.`;
      if (serverSkippedCount > 0) {
        msg +=
          ` ${serverSkippedCount} kode DILEWATI karena belum terdaftar di master_produk: ` +
          serverSkippedCodes.slice(0, 15).join(", ") +
          (serverSkippedCodes.length > 15
            ? `, dan ${serverSkippedCodes.length - 15} lainnya…`
            : "");
      }
      setStatusMsg({ kind: serverSkippedCount > 0 ? "err" : "ok", text: msg });
      await recordUpload({
        at: new Date().toISOString(),
        email,
        fileName: currentFileName,
        total: parsedRows.length,
        skipped: serverSkippedCount,
        skippedCodes: serverSkippedCodes,
      });
      setHistoryShowAll(false);
      await refreshHistory();
      resetUploadUI();
    } catch (err) {
      setStatusMsg({ kind: "fail", text: `Gagal: ${(err as Error).message}` });
    } finally {
      setUploading(false);
    }
  }

  const lastStatus = history[0] || null;
  const visibleHistory = historyShowAll ? history : history.slice(0, 5);
  const filteredSkipped = skipSearch.trim()
    ? (skippedRows || []).filter((r) =>
        r.kode_asli.toLowerCase().includes(skipSearch.trim().toLowerCase())
      )
    : skippedRows || [];

  const localNote =
    sharedHistoryAvailable === false
      ? "Riwayat bersama belum aktif (tabel stok_upload_log belum ada) — sementara pakai riwayat lokal di browser ini saja."
      : "Riwayat ini dibagikan ke semua user divisi, diambil dari tabel stok_upload_log.";

  if (!authReady) return null;

  const loggedIn = !!accessToken;

  return (
    <div data-theme={theme ?? undefined}>
      {/* React 19 hoists these into <head> automatically */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
      />
      <link
        rel="stylesheet"
        href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/fill/style.css"
      />
      {!loggedIn && (
        <div className="auth-gate">
          <button className="theme-toggle" onClick={toggleTheme} title="Ganti tema">
            <i className={effectiveTheme === "light" ? "ph ph-moon" : "ph ph-sun"} />
          </button>
          <div className="auth-gate-box">
            <div className="auth-gate-icon">
              <i className="ph ph-package" />
            </div>
            <div className="auth-gate-title">Stock Inventory</div>
            <div className="auth-gate-sub">Masuk untuk melanjutkan.</div>
            <div className="pr-field">
              <label>Email</label>
              <input
                type="email"
                placeholder="nama@email.com"
                autoComplete="email"
                value={gateEmail}
                onChange={(e) => setGateEmail(e.target.value)}
              />
            </div>
            <div className="pr-field">
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                value={gatePassword}
                onChange={(e) => setGatePassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>
            <button className="auth-gate-btn" disabled={gateBusy} onClick={handleLogin}>
              {gateBusy ? "Memproses…" : "Masuk"}
            </button>
            <div
              className="auth-gate-status"
              style={{ color: gateStatus ? "var(--danger-text)" : undefined }}
            >
              {gateStatus}
            </div>
          </div>
        </div>
      )}

      {loggedIn && (
        <div>
          <div className="topbar">
            <Link className="back-link" href="/">
              <i className="ph ph-arrow-left" /> Semua Modul
            </Link>
            <div className="topbar-right">
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Pionir Group — PNM / SMY / METO
              </span>
              <button className="theme-toggle" onClick={toggleTheme} title="Ganti tema">
                <i className={effectiveTheme === "light" ? "ph ph-moon" : "ph ph-sun"} />
              </button>
              <button className="logout-link" onClick={handleLogout}>
                Keluar
              </button>
            </div>
          </div>
          <main>
            <div className="page-head">
              <h1>Stock Inventory</h1>
              <p>Upload &amp; perbarui stok harian untuk seluruh divisi.</p>
            </div>

            {/* LAST SYNC */}
            <div className="card">
              {historyBusy && history.length === 0 ? (
                <div className="summary-empty">Memuat status terakhir…</div>
              ) : !lastStatus ? (
                <div className="summary-empty">Belum ada riwayat upload.</div>
              ) : (
                <div className="summary-row">
                  <div className="summary-main">
                    <div className="icon-box green">
                      <i className="ph ph-trend-up" />
                    </div>
                    <div className="summary-main-text">
                      <div className="lbl">Last Sync</div>
                      <div className="val">
                        {fmtWhen(lastStatus.at).date}, {fmtWhen(lastStatus.at).time}
                      </div>
                      <div className="who">
                        <i className="ph ph-user-circle" />
                        {lastStatus.email || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="metric-group">
                    <div className="metric green">
                      <div className="metric-icon green">
                        <i className="ph ph-check-circle" />
                      </div>
                      <div>
                        <div className="num">{lastStatus.total.toLocaleString("id-ID")}</div>
                        <div className="lbl2">Updated</div>
                      </div>
                    </div>
                    <div className="metric amber">
                      <div className="metric-icon amber">
                        <i className="ph ph-warning" />
                      </div>
                      <div>
                        <div className="num">{lastStatus.skipped.toLocaleString("id-ID")}</div>
                        <div className="lbl2">Skipped</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* UPLOAD */}
            <div className="card">
              <div className="card-head">
                <div className="icon-box blue">
                  <i className="ph ph-cloud-arrow-up" />
                </div>
                <div className="card-head-text">
                  <h2>Upload File Stok Baru</h2>
                  <p>
                    Upload file Excel harian dengan kolom <b>KODEASLI</b> dan{" "}
                    <b>QTY</b>. Pastikan file yang diupload sudah data terbaru &amp;
                    lengkap.
                  </p>
                </div>
              </div>

              <label
                className={`dropzone${dragOver ? " drag" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files[0];
                  if (f) handleFile(f);
                }}
              >
                <div className="dropzone-icon">
                  <i className="ph ph-upload-simple" />
                </div>
                <div className="dropzone-title">Drag &amp; drop file Excel di sini</div>
                <div className="dropzone-sub">atau klik untuk memilih file</div>
                <span className="dropzone-badge">Format: .xlsx, .xls</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>

              {currentFileName && (
                <div className="file-row">
                  <div className="fico">
                    <i className="ph ph-file-xls" />
                  </div>
                  <div className="finfo">
                    <div className="fname">{currentFileName}</div>
                    <div className="fmeta">
                      {fmtSize(currentFileSize || 0)}
                      {parsedRows ? ` • ${parsedRows.length.toLocaleString("id-ID")} baris` : ""}
                    </div>
                  </div>
                  <button className="fdel" title="Hapus file" onClick={resetUploadUI}>
                    <i className="ph ph-trash" />
                  </button>
                </div>
              )}

              {dupCount > 0 && (
                <div className="result-banner err">
                  Catatan: {dupCount} kode duplikat ditemukan di file, baris terakhir
                  untuk tiap kode yang dipakai.
                </div>
              )}

              {checkingText && (
                <div className="checking-row">
                  <div className="spinner" />
                  <span>{checkingText}</span>
                </div>
              )}
              {checkingText && (
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
              )}

              {!checkingText && parsedRows && (
                <div>
                  <div className="stat-row">
                    <div className="stat-pill">
                      <div className="num">{parsedRows.length.toLocaleString("id-ID")}</div>
                      <div className="lbl">Total baris di file</div>
                    </div>
                    <div className="stat-pill ok">
                      <div className="num">
                        {(matchedRows?.length ?? 0).toLocaleString("id-ID")}
                      </div>
                      <div className="lbl">Akan diperbarui</div>
                    </div>
                    <div className="stat-pill warn">
                      <div className="num">
                        {(skippedRows?.length ?? 0).toLocaleString("id-ID")}
                      </div>
                      <div className="lbl">Dilewati (belum terdaftar)</div>
                    </div>
                  </div>

                  {skippedRows && skippedRows.length > 0 && (
                    <div className="skip-panel">
                      <div className="skip-head">
                        <div className="skip-head-title">
                          <i className="ph ph-warning" /> Kode yang belum jadi produk
                          kita, tapi ada stoknya
                        </div>
                        <div className="skip-actions">
                          <button
                            className="mini-btn"
                            onClick={async () => {
                              await navigator.clipboard.writeText(
                                skippedRows.map((r) => r.kode_asli).join("\n")
                              );
                            }}
                          >
                            <i className="ph ph-copy" />
                            Salin
                          </button>
                          <button
                            className="mini-btn"
                            onClick={() =>
                              downloadCsv(
                                `stok-dilewati-${new Date().toISOString().slice(0, 10)}.csv`,
                                ["kode_asli,qty", ...skippedRows.map((r) => `${r.kode_asli},${r.qty}`)].join(
                                  "\n"
                                )
                              )
                            }
                          >
                            <i className="ph ph-download-simple" />
                            Export CSV
                          </button>
                        </div>
                      </div>
                      <p className="skip-note">
                        Kode-kode ini ada di file stok tapi belum terdaftar di{" "}
                        <b>master_produk</b> — stoknya <b>tidak akan tersimpan</b>.
                        Teruskan ke tim yang mengelola pendaftaran produk kalau kode
                        ini memang seharusnya sudah jadi produk.
                      </p>
                      <input
                        type="text"
                        className="skip-search"
                        placeholder="Cari kode…"
                        value={skipSearch}
                        onChange={(e) => setSkipSearch(e.target.value)}
                      />
                      <div className="skip-table-wrap">
                        <table className="skip-table">
                          <thead>
                            <tr>
                              <th>Kode Asli</th>
                              <th>Qty di file</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredSkipped.length === 0 ? (
                              <tr>
                                <td colSpan={2} style={{ color: "var(--text-muted)" }}>
                                  Tidak ada yang cocok.
                                </td>
                              </tr>
                            ) : (
                              filteredSkipped
                                .slice(0, 500)
                                .map((r, i) => (
                                  <tr key={i}>
                                    <td>{r.kode_asli}</td>
                                    <td>{r.qty}</td>
                                  </tr>
                                ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="actions-row">
                    <button className="btn-secondary" onClick={resetUploadUI}>
                      Batal
                    </button>
                    <button
                      className="btn-primary-lg"
                      disabled={uploading}
                      onClick={handleUploadClick}
                    >
                      {uploading ? (
                        <>
                          <div
                            className="spinner"
                            style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,.35)" }}
                          />
                          &nbsp;Mengupload…
                        </>
                      ) : (
                        <>
                          <i className="ph ph-upload-simple" />
                          Upload Stock
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {statusMsg && (
                <div className={`result-banner ${statusMsg.kind}`}>{statusMsg.text}</div>
              )}

              <div className="trust-note">
                <i className="ph ph-shield-check" />
                Data stok akan menggantikan data stok sebelumnya. Pastikan file sudah
                sesuai sebelum upload.
              </div>
            </div>

            {/* RIWAYAT */}
            <div className="card">
              <div className="card-head">
                <div className="icon-box amber">
                  <i className="ph ph-clock-counter-clockwise" />
                </div>
                <div className="card-head-text">
                  <h2>Recent Activity</h2>
                  <p>Riwayat upload stok dari seluruh divisi.</p>
                </div>
                <div className="card-head-action" style={{ display: "flex", gap: 8 }}>
                  <button
                    className="mini-btn"
                    title="Muat ulang riwayat"
                    disabled={historyBusy}
                    onClick={refreshHistory}
                  >
                    <i
                      className="ph ph-arrow-clockwise"
                      style={historyBusy ? { animation: "spin .7s linear infinite" } : undefined}
                    />
                    Refresh
                  </button>
                  {history.length > 5 && (
                    <button
                      className="mini-btn"
                      onClick={() => setHistoryShowAll((v) => !v)}
                    >
                      {historyShowAll ? (
                        <>
                          Ringkas <i className="ph ph-caret-up" />
                        </>
                      ) : (
                        <>
                          Lihat Semua <i className="ph ph-caret-right" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="activity-table">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>User</th>
                      <th>Updated</th>
                      <th>Skipped</th>
                      <th>File</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleHistory.map((h, i) => {
                      const w = fmtWhen(h.at);
                      return (
                        <tr key={h.id ?? i}>
                          <td className="act-when">
                            <div className="d">{w.date}</div>
                            <div className="t">{w.time}</div>
                          </td>
                          <td>
                            <div className="act-user">
                              <div className="act-user-icon">{initials(h.email)}</div>
                              {h.email || "Tidak diketahui"}
                            </div>
                          </td>
                          <td className="act-num green">{h.total.toLocaleString("id-ID")}</td>
                          <td className={`act-num ${h.skipped > 0 ? "amber" : ""}`}>
                            {h.skipped.toLocaleString("id-ID")}
                          </td>
                          <td className="act-file" title={h.fileName || ""}>
                            {h.fileName || "—"}
                          </td>
                          <td>
                            <button
                              className="act-dl"
                              title={
                                h.skipped > 0
                                  ? "Download kode yang dilewati"
                                  : "Tidak ada yang dilewati"
                              }
                              disabled={!h.id || h.skipped === 0}
                              onClick={() => h.id && downloadSkippedForRow(h.id)}
                            >
                              <i className="ph ph-download-simple" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {history.length === 0 && !historyBusy && (
                <div className="activity-empty">Belum ada riwayat upload.</div>
              )}
              <div className="local-note">
                <i className="ph ph-info" />
                <span>{localNote}</span>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
