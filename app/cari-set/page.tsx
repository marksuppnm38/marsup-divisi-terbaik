"use client";

import { Fragment, useState } from "react";
import { restRpcAnon } from "@/lib/supabase-rest";
import "./cari-set.css";

type SetResult = {
  set_id: number | string;
  kode_set: string;
  nama_set: string | null;
  jumlah_cocok: number;
  total_item_set: number;
  skor_jaccard: number;
};

type DetailItem = {
  urutan: number;
  kode_item: string;
  nama_item: string | null;
  qty: number;
  cocok_dengan_input: boolean;
};

function skorClass(skor: number) {
  if (skor >= 0.7) return "high";
  if (skor >= 0.4) return "mid";
  return "low";
}

export default function CariSetPage() {
  const [kodeInput, setKodeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [results, setResults] = useState<SetResult[] | null>(null);
  const [openDetailFor, setOpenDetailFor] = useState<string | number | null>(null);
  const [detail, setDetail] = useState<DetailItem[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const kodeList = kodeInput
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  async function cariSet() {
    if (kodeList.length === 0) {
      setStatus({ text: "Isi dulu daftar kode_produk-nya.", error: true });
      return;
    }
    setBusy(true);
    setStatus({ text: "Mencari..." });
    setResults(null);
    setOpenDetailFor(null);

    try {
      const res = await restRpcAnon("cari_set_mendekati", {
        kode_list: kodeList,
        batas: 30,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.hint || "Gagal memanggil RPC");
      }
      if (!data || data.length === 0) {
        setStatus({ text: "" });
        setResults([]);
      } else {
        setStatus({ text: `Ditemukan ${data.length} SET, diurutkan dari yang paling mirip.` });
        setResults(data);
      }
    } catch (err) {
      setStatus({ text: "Gagal: " + (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }

  async function toggleDetail(setId: number | string) {
    if (openDetailFor === setId) {
      setOpenDetailFor(null);
      setDetail(null);
      return;
    }
    setOpenDetailFor(setId);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await restRpcAnon("detail_isi_set", {
        p_set_id: setId,
        kode_list: kodeList,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.hint || "Gagal memanggil RPC");
      }
      setDetail(data || []);
    } catch (err) {
      setStatus({ text: "Gagal ambil detail: " + (err as Error).message, error: true });
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <div className="wrap">
      <h1>Cari SET Mendekati</h1>
      <p className="sub">
        Tempel daftar kode_produk (satu per baris), lalu cari SET dengan isi paling
        mirip.
      </p>

      <label htmlFor="kodeInput">Daftar kode_produk</label>
      <textarea
        id="kodeInput"
        placeholder={"RB10-KE100-B004-U07\nRB10-KE130-B003-U07\n..."}
        value={kodeInput}
        onChange={(e) => setKodeInput(e.target.value)}
      />

      <div className="row">
        <button id="searchBtn" disabled={busy} onClick={cariSet}>
          Cari SET Mendekati
        </button>
        <span className="count-badge">{kodeList.length} kode</span>
      </div>
      {status && (
        <div className={`status${status.error ? " error" : ""}`}>{status.text}</div>
      )}

      {results && results.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ width: "38%" }}>SET</th>
              <th>Cocok</th>
              <th>Skor</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => {
              const pct = Math.round(row.skor_jaccard * 100);
              const isOpen = openDetailFor === row.set_id;
              return (
                <Fragment key={row.set_id}>
                  <tr>
                    <td>
                      <div className="kode-set">{row.kode_set}</div>
                      <div className="nama-set">{row.nama_set || ""}</div>
                    </td>
                    <td>
                      {row.jumlah_cocok} / {row.total_item_set}{" "}
                      <span style={{ color: "var(--text-dim)" }}>item set</span>
                    </td>
                    <td>
                      <div className={`skor ${skorClass(row.skor_jaccard)}`}>{pct}%</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td>
                      <button className="detail-btn" onClick={() => toggleDetail(row.set_id)}>
                        {isOpen ? (detailLoading ? "Memuat..." : "Sembunyikan") : "Lihat isi"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row" key={`${row.set_id}-detail`}>
                      <td colSpan={4}>
                        <div className="detail-inner">
                          {detailLoading
                            ? "Memuat..."
                            : (detail || []).length === 0
                              ? "Tidak ada item."
                              : (detail || []).map((it) => (
                                  <div
                                    key={it.urutan}
                                    className={`item-line ${
                                      it.cocok_dengan_input ? "match" : "nomatch"
                                    }`}
                                  >
                                    <span>
                                      {it.urutan}. {it.kode_item} — {it.nama_item || ""}
                                    </span>
                                    <span>
                                      qty {it.qty}{" "}
                                      {it.cocok_dengan_input && <span className="tag">cocok</span>}
                                    </span>
                                  </div>
                                ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {results && results.length === 0 && (
        <div className="empty">Tidak ada SET yang cocok ditemukan.</div>
      )}
    </div>
  );
}
