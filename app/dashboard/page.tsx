"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  clearAuthSession,
  loginWithPassword,
  resolveAccessToken,
  saveAuthSession,
} from "@/lib/auth-session";
import { restRpc } from "@/lib/supabase-rest";
import "./dashboard.css";

type KonversiToday = {
  berjalan_count: number;
  berjalan_baru_count: number;
  selesai_count: number;
  selesai_value: number;
  selesai_avg: number;
};

type Summary = {
  total: number;
  punya_harga: number;
  punya_link: number;
  punya_akd: number;
  instrument: number;
  instrument_punya_harga: number;
  set: number;
  set_punya_harga: number;
  unit: number;
  unit_punya_harga: number;
};

function fmt(n: number) {
  return Number(n || 0).toLocaleString("id-ID");
}
function pct(a: number, b: number) {
  return b ? Math.round((a / b) * 100) : 0;
}
function pctClass(p: number) {
  return p >= 80 ? "pct-good" : p >= 50 ? "pct-warn" : "pct-bad";
}
function rupiah(n: number) {
  return n ? "Rp " + Number(n).toLocaleString("id-ID") : "—";
}

function ProgItem({
  name,
  val,
  total,
  color,
}: {
  name: string;
  val: number;
  total: number;
  color: string;
}) {
  const p = pct(val, total);
  return (
    <div className="prog-item">
      <div className="prog-meta">
        <span className="prog-name">{name}</span>
        <span className="prog-num">
          {fmt(val)} / {fmt(total)}
        </span>
      </div>
      <div className="prog-track">
        <div className="prog-fill" style={{ width: `${p}%`, background: color }} />
      </div>
      <div className="prog-pct">{p}%</div>
    </div>
  );
}

export default function DashboardPage() {
  // ---- theme ----
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pnm-theme") as "light" | "dark" | null;
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage/matchMedia, real external systems
      setTheme(stored || (prefersDark ? "dark" : "light"));
    } catch {}
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("pnm-theme", next);
    } catch {}
  }

  // ---- auth ----
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [gateEmail, setGateEmail] = useState("");
  const [gatePassword, setGatePassword] = useState("");
  const [gateStatus, setGateStatus] = useState("");
  const [gateBusy, setGateBusy] = useState(false);

  const initAuth = useCallback(async () => {
    const { token, expiredMessage } = await resolveAccessToken();
    setAccessToken(token);
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
  }

  // ---- data ----
  const [konversi, setKonversi] = useState<KonversiToday | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function rpc<T>(fn: string, params: unknown): Promise<T> {
    if (!accessToken) throw new Error("unauthorized");
    const res = await restRpc(fn, params || {}, accessToken);
    if (res.status === 401) {
      setGateStatus("Sesi kamu sudah habis, silakan masuk lagi.");
      handleLogout();
      throw new Error("unauthorized");
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error_description || `RPC ${fn} gagal`);
    return data;
  }

  const loadEverything = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [k, s] = await Promise.all([
        rpc<KonversiToday>("get_dashboard_konversi_today", {}),
        rpc<Summary>("get_dashboard_summary", {}),
      ]);
      setKonversi(k);
      setSummary(s);
      setLastUpdate(new Date().toLocaleTimeString("id-ID"));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching dashboard data from Supabase whenever auth becomes available
    if (accessToken) loadEverything();
  }, [accessToken, loadEverything]);

  if (!authReady) return null;
  const loggedIn = !!accessToken;
  const total = summary?.total || 0;

  return (
    <div data-theme={theme}>
      <link
        rel="stylesheet"
        href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
      />
      {!loggedIn && (
        <div id="auth-gate" className="auth-gate">
          <div className="auth-gate-box">
            <div className="auth-gate-title">Dashboard Produk</div>
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
            <div className="auth-gate-status" style={{ color: gateStatus ? "var(--danger)" : undefined }}>
              {gateStatus}
            </div>
          </div>
        </div>
      )}

      {loggedIn && (
        <div id="app-root">
          <header>
            <div>
              <div className="logo-text">PT Pionir Nusantara Manufacturing</div>
              <div className="logo-sub">Dashboard Produk</div>
            </div>
            <div className="header-right">
              <span className="last-update">
                <i className="ph ph-arrows-clockwise" />{" "}
                {loading ? "Memuat…" : lastUpdate ? `Live — ${lastUpdate}` : "—"}
              </span>
              <Link className="toggle-btn" href="/">
                <i className="ph ph-house" /> Beranda
              </Link>
              <button className="toggle-btn" onClick={loadEverything} title="Muat ulang">
                <i className="ph ph-arrow-clockwise" /> Muat ulang
              </button>
              <button className="toggle-btn" onClick={toggleTheme} title="Ganti tema">
                <i className={theme === "dark" ? "ph ph-sun" : "ph ph-moon"} />
              </button>
              <button className="toggle-btn" onClick={handleLogout} title="Keluar">
                <i className="ph ph-sign-out" /> Keluar
              </button>
            </div>
          </header>

          <main>
            {loadError && (
              <div className="err-banner show">
                <i className="ph ph-warning-circle" /> <span>{loadError}</span>
              </div>
            )}

            <div className="section-label">
              <i className="ph ph-arrows-clockwise" /> Konversi Hari Ini
            </div>
            <div className="stats-grid">
              {!konversi ? (
                <>
                  <div className="stat-card blue">
                    <div className="skeleton" style={{ width: "60%", height: 25, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: "40%" }} />
                  </div>
                  <div className="stat-card green">
                    <div className="skeleton" style={{ width: "60%", height: 25, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: "40%" }} />
                  </div>
                  <div className="stat-card purple">
                    <div className="skeleton" style={{ width: "60%", height: 25, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: "40%" }} />
                  </div>
                </>
              ) : (
                <>
                  <div className="stat-card blue">
                    <div className="stat-icon blue">
                      <i className="ph ph-hourglass-medium" />
                    </div>
                    <div className="stat-val">{fmt(konversi.berjalan_count)}</div>
                    <div className="stat-label">Konversi Sedang Berjalan</div>
                    <div className="stat-sub">
                      <i className="ph ph-plus-circle" /> {fmt(konversi.berjalan_baru_count)} sesi baru
                      dibuka hari ini
                    </div>
                  </div>
                  <div className="stat-card green">
                    <div className="stat-icon green">
                      <i className="ph ph-check-circle" />
                    </div>
                    <div className="stat-val">{fmt(konversi.selesai_count)}</div>
                    <div className="stat-label">Konversi Selesai Hari Ini</div>
                    <div className="stat-sub">
                      <i className="ph ph-money" /> Total {rupiah(konversi.selesai_value)}
                    </div>
                  </div>
                  <div className="stat-card purple">
                    <div className="stat-icon purple">
                      <i className="ph ph-chart-line-up" />
                    </div>
                    <div className="stat-val">{rupiah(konversi.selesai_avg)}</div>
                    <div className="stat-label">Rata-rata Value / Order</div>
                    <div className="stat-sub">
                      <i className="ph ph-info" /> Dari {fmt(konversi.selesai_count)} order hari ini
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="section-label">
              <i className="ph ph-database" /> Ringkasan Database
            </div>
            <div className="stats-grid">
              {!summary ? (
                [...Array(5)].map((_, i) => (
                  <div className="stat-card blue" key={i}>
                    <div className="skeleton" style={{ width: "60%", height: 25, marginBottom: 8 }} />
                    <div className="skeleton" style={{ width: "40%" }} />
                  </div>
                ))
              ) : (
                <>
                  <div className="stat-card blue">
                    <div className="stat-icon blue">
                      <i className="ph ph-database" />
                    </div>
                    <div className="stat-val">{fmt(total)}</div>
                    <div className="stat-label">Total Produk</div>
                    <div className="stat-sub">
                      <i className="ph ph-check-circle" style={{ color: "var(--success)" }} /> Semua aktif
                      di database
                    </div>
                  </div>
                  <div className="stat-card green">
                    <div className="stat-icon green">
                      <i className="ph ph-money" />
                    </div>
                    <div className="stat-val">{fmt(summary.punya_harga)}</div>
                    <div className="stat-label">Punya Harga e-Katalog</div>
                    <div className="stat-sub">
                      <span className={`stat-pct ${pctClass(pct(summary.punya_harga, total))}`}>
                        {pct(summary.punya_harga, total)}%
                      </span>{" "}
                      dari total produk
                    </div>
                  </div>
                  <div className="stat-card warning">
                    <div className="stat-icon warning">
                      <i className="ph ph-currency-circle-dollar" />
                    </div>
                    <div className="stat-val">{fmt(total - summary.punya_harga)}</div>
                    <div className="stat-label">Belum Ada Harga</div>
                    <div className="stat-sub">
                      <span className="stat-pct pct-bad">
                        {pct(total - summary.punya_harga, total)}%
                      </span>{" "}
                      perlu dilengkapi
                    </div>
                  </div>
                  <div className="stat-card blue">
                    <div className="stat-icon blue">
                      <i className="ph ph-link" />
                    </div>
                    <div className="stat-val">{fmt(summary.punya_link)}</div>
                    <div className="stat-label">Ada di e-Katalog v6</div>
                    <div className="stat-sub">
                      <span className={`stat-pct ${pctClass(pct(summary.punya_link, total))}`}>
                        {pct(summary.punya_link, total)}%
                      </span>{" "}
                      dari total produk
                    </div>
                  </div>
                  <div className="stat-card purple">
                    <div className="stat-icon purple">
                      <i className="ph ph-seal-check" />
                    </div>
                    <div className="stat-val">{fmt(summary.punya_akd)}</div>
                    <div className="stat-label">Punya Nomor AKD</div>
                    <div className="stat-sub">
                      <span className={`stat-pct ${pctClass(pct(summary.punya_akd, total))}`}>
                        {pct(summary.punya_akd, total)}%
                      </span>{" "}
                      dari total produk
                    </div>
                  </div>
                  <div className="stat-card danger">
                    <div className="stat-icon danger">
                      <i className="ph ph-link-break" />
                    </div>
                    <div className="stat-val">{fmt(total - summary.punya_link)}</div>
                    <div className="stat-label">Belum di e-Katalog</div>
                    <div className="stat-sub">
                      <span className="stat-pct pct-bad">
                        {pct(total - summary.punya_link, total)}%
                      </span>{" "}
                      belum terdaftar
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="section-label">
              <i className="ph ph-chart-bar" /> Kelengkapan Data
            </div>
            <div className="prog-cards">
              <div className="prog-card">
                <div className="prog-card-title">
                  <i className="ph ph-money" style={{ color: "var(--success)" }} /> Harga e-Katalog
                </div>
                {summary && (
                  <div>
                    <ProgItem
                      name="Instrumen"
                      val={summary.instrument_punya_harga}
                      total={summary.instrument}
                      color="var(--accent)"
                    />
                    <ProgItem
                      name="Set"
                      val={summary.set_punya_harga}
                      total={summary.set}
                      color="var(--success)"
                    />
                    <ProgItem
                      name="Unit"
                      val={summary.unit_punya_harga}
                      total={summary.unit}
                      color="var(--purple)"
                    />
                  </div>
                )}
              </div>
              <div className="prog-card">
                <div className="prog-card-title">
                  <i className="ph ph-link" style={{ color: "var(--accent)" }} /> e-Katalog v6
                </div>
                {summary && (
                  <div>
                    <ProgItem name="Punya Link v6" val={summary.punya_link} total={total} color="var(--accent)" />
                    <ProgItem
                      name="Belum Ada Link"
                      val={total - summary.punya_link}
                      total={total}
                      color="var(--danger)"
                    />
                  </div>
                )}
              </div>
              <div className="prog-card">
                <div className="prog-card-title">
                  <i className="ph ph-seal-check" style={{ color: "var(--warning)" }} /> Nomor AKD
                </div>
                {summary && (
                  <div>
                    <ProgItem name="Punya AKD" val={summary.punya_akd} total={total} color="var(--warning)" />
                    <ProgItem
                      name="Tanpa AKD"
                      val={total - summary.punya_akd}
                      total={total}
                      color="var(--danger)"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="section-label">
              <i className="ph ph-construction" /> Belum dimigrasi
            </div>
            <div className="insight-card" style={{ marginBottom: 26 }}>
              <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13.5 }}>
                Insight konversi (trend, leaderboard, donut kategori, line chart, word
                tree, forecasting stok), Daftar Produk (tabel + search/filter/preset/bulk
                export + detail modal), dan Populasi Produk per Wilayah masih ada di{" "}
                <a href="/dashboard.html">dashboard.html</a> versi lama untuk sementara —
                nyusul di fase migrasi berikutnya.
              </p>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
