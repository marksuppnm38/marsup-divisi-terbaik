"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import "./hub.css";

// Status of each module in the Next.js migration. Update as more modules
// move over — a module pointing at an old .html path is unmigrated and
// expects the old static site to still be reachable at that relative path.
const MODULES = [
  {
    title: "Konversi",
    desc: "Cari produk, susun harga, dan export ke Excel dengan gambar.",
    href: "/konversian.html",
    migrated: false,
    icon: (
      <path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
    ),
  },
  {
    title: "SPH Generator",
    desc: "Buat Surat Penawaran Harga dari sheet SUMMARY, lengkap dengan lampiran.",
    href: "/generatesph.html",
    migrated: false,
    icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h2" />,
  },
  {
    title: "Stok",
    desc: "Upload & timpa data stok harian — bisa dipakai divisi mana pun, gak perlu buka Konversian.",
    href: "/stok",
    migrated: true,
    icon: (
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    ),
  },
  {
    title: "CRUD Produk",
    desc: "Edit data produk, harga, dan deskripsi.",
    href: "/crud-produk.html",
    migrated: false,
    icon: <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />,
  },
  {
    title: "Cari SET Mendekati",
    desc: "Cocokkan daftar kode instrumen dengan isi SET yang paling mirip di database.",
    href: "/cari_set.html",
    migrated: false,
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </>
    ),
  },
  {
    title: "Dashboard",
    desc: "Ringkasan penjualan dan aktivitas tim lintas perusahaan.",
    href: "/dashboard.html",
    migrated: false,
    icon: (
      <>
        <rect x="3" y="3" width="7" height="9" />
        <rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" />
        <rect x="3" y="16" width="7" height="5" />
      </>
    ),
  },
];

export default function HubPage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    try {
      const stored = localStorage.getItem("pnum-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from localStorage/matchMedia, real external systems
      setTheme((stored as "light" | "dark") || (prefersDark ? "dark" : "light"));
    } catch {}
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem("pnum-theme", next);
    } catch {}
  }

  return (
    <div className="wrap" data-theme={theme === "dark" ? "dark" : undefined}>
      <header>
        <div className="brand">
          <Image src="/logo-mark-pnm.png" alt="PNM logo" width={40} height={40} />
          <div className="brand-text">
            <h1>Tools Manifest</h1>
            <p>Pionir Group · Internal</p>
          </div>
        </div>
        <div className="header-right">
          <div className="breadcrumb">
            Pionir Group — PNM / SMY / METO
            <br />
            marketing &amp; sales ops
          </div>
          <button
            className="theme-toggle"
            aria-label="Ganti tema"
            title="Ganti tema"
            onClick={toggleTheme}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </button>
        </div>
      </header>
      <div className="section-label">Modul Aktif</div>
      <div className="modules">
        {MODULES.map((m) => (
          <Link key={m.title} className="module" href={m.href}>
            <div className="module-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {m.icon}
              </svg>
            </div>
            <div className="module-body">
              <div className="module-title">{m.title}</div>
              <div className="module-desc">{m.desc}</div>
            </div>
            <div className="status live">
              {m.migrated ? "Live (Next.js)" : "Live"}
            </div>
          </Link>
        ))}
      </div>
      <footer>
        <span>tools-conversion.vercel.app</span>
        <span>Diperbarui manual via Vercel CLI</span>
      </footer>
    </div>
  );
}
