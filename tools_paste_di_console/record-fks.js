/**
 * Jalankan di Console (F12) saat sudah login di https://penyedia.inaproc.id/order?status=all
 * Output: langsung ke clipboard (tinggal paste) + file .tsv cadangan.
 * Hasil juga tersimpan di window.__tsv
 */
(async function exportInaprocOrders() {
  // ====== PENGATURAN ======
  const MANUFACTURER = "PNM";   // kolom MANUFACTURES ("" kalau mau kosong)
  const LINK_EKATALOG = "PNM";  // kolom LINK EKATALOG ("" kalau mau kosong)
  // ========================

  const API = "https://penyedia.inaproc.id/graphql";
  async function gql(body) {
    const res = await fetch(API, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} - pastikan sudah login & masih di tab penyedia.inaproc.id`);
    return res.json();
  }

  // ---------- Helper format ----------
  const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const fmtDate = (v) => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return "";
    return `${d.getDate()}-${BULAN[d.getMonth()]}-${d.getFullYear()}`;
  };
  const fmtRp = (n) => {
    if (n === "" || n === null || n === undefined || isNaN(Number(n))) return "";
    return "Rp " + Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  };
  const clean = (v) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- 1. List order ----------
  const STATUS_LIST = [
    "WAITING_SELLER_CONFIRMATION","ESIGN_IN_PROGRESS","ON_PROCESS","SHIPPING",
    "PARTIALLY_SHIPPING","DELIVERED","PARTIALLY_DELIVERED",
    "PARTIALLY_WORKING_PROGRESS_PENDING","WORKING_PROGRESS_PENDING",
    "WORKING_PROGRESS_REJECTED","BUYER_CONFIRMED","PARTIALLY_BUYER_CONFIRMED",
    "SHIPMENT_COMPLETED","PARTIALLY_SHIPMENT_COMPLETED","PARTIALLY_BAPP_COMPLETED",
    "BAPP_COMPLETED","PAYMENT_OUTSIDE_SYSTEM_IN_PROGRESS","PARTIALLY_ON_PROCESS_PAYMENT",
    "ON_PROCESS_PAYMENT","PARTIALLY_BUYER_PAID","BUYER_PAID","PARTIALLY_SELLER_PAID",
    "PARTIALLY_PAYMENT_OUTSIDE_SYSTEM","COMPLETED","PAYMENT_OUTSIDE_SYSTEM","CANCELLED",
    "EXPIRED","REJECTED","CANCELLED_VIA_RESOLUTION","REQUEST_CANCEL",
    "REQUEST_CANCEL_VIA_RESOLUTION","ADDENDUM_DRAFT","ADDENDUM_ESIGN_IN_PROGRESS","ADDENDUM_NEW",
  ];

  const LIST_QUERY = `query unreadChatCount($_v2_input: OrderListInput!) {
    _v2_orderListV2: orderListV2(input: $_v2_input) {
      ... on OrderListResponse {
        __typename currentPage lastPage perPage total
        items { orderNumber orderKey id status timestamp }
      }
      ... on GenericError { __typename code message }
    }
  }`;

  let allOrders = [];
  let page = 1, lastPage = 1;
  do {
    const resp = await gql({
      query: LIST_QUERY,
      variables: {
        _v2_input: {
          filter: { text: "", status: STATUS_LIST },
          pagination: { page, perPage: 50 },
          sort: { field: "ORDERED_AT", direction: "DESCENDING" },
        },
      },
      operationName: "unreadChatCount",
    });
    const data = resp?.data?._v2_orderListV2;
    if (!data || data.__typename !== "OrderListResponse") {
      console.error("Gagal ambil list order:", data);
      break;
    }
    allOrders.push(...data.items);
    lastPage = data.lastPage;
    console.log(`List order... halaman ${page}/${lastPage} (sejauh ini: ${allOrders.length})`);
    page++;
  } while (page <= lastPage);
  console.log(`Total order: ${allOrders.length}`);

  // ---------- 2. Detail order ----------
  const DETAIL_QUERY = `query getOrderDetailForExport($input: OrderInput!) {
    orderDetailV2(input: $input) {
      ... on OrderV2 {
        __typename id orderNumber orderKey timestamp expiryTime total totalWithoutTax status totalShipment
        items {
          qty originalPrice lastPrice subTotal productId
          tax { ppnPercentage ppnBmPercentage ppn ppnBm taxableRate }
          snapshot { id name type pdn { type } stockUnit { primaryUnit } }
        }
        shipmentSummary { provider service totalShipmentFee totalShipmentPrice totalShipmentPriceWithoutPPN }
        payments { id phase deliveryOrderGroupId status }
        sellerInfo { company { name slug npwp } }
        resellerInfo { company { name slug } }
        buyerInfo { assignedUser { buyerSnapshot { institutionName nameSatuanKerja } } }
      }
      ... on GenericError { __typename code message reqId }
    }
  }`;

  const DELIVERY_QUERY = `query getDeliveryOrderListForExport($filter: FilterDeliveryOrderList!, $pagination: Pagination!, $sort: DeliveryOrderListSort) {
    deliveryOrderList(input: { filter: $filter, pagination: $pagination, sort: $sort }) {
      ... on DeliveryOrderList {
        __typename
        deliveryOrders { id requestDateArrival requestDateArrivalStart requestDateArrivalEnd requestDateArrivalNotes }
      }
      ... on GenericError { __typename code message }
    }
  }`;

  async function getDeadlineFks(groupId) {
    if (!groupId) return "";
    try {
      const resp = await gql({
        query: DELIVERY_QUERY,
        variables: {
          filter: { deliveryGroupId: groupId },
          pagination: { page: 1, perPage: 10 },
          sort: { direction: "ASCENDING", field: "DELIVERY_NUMBER" },
        },
        operationName: "getDeliveryOrderListForExport",
      });
      const dList = resp?.data?.deliveryOrderList;
      if (!dList || dList.__typename !== "DeliveryOrderList") return "";
      const dates = (dList.deliveryOrders || []).map((x) => {
        if (x.requestDateArrivalStart && x.requestDateArrivalEnd) {
          const a = fmtDate(x.requestDateArrivalStart), b = fmtDate(x.requestDateArrivalEnd);
          return a === b ? a : `${a} - ${b}`;
        }
        return fmtDate(x.requestDateArrival);
      }).filter(Boolean);
      return [...new Set(dates)].join("; ");
    } catch (err) {
      console.warn("Gagal ambil requestDateArrival:", err);
      return "";
    }
  }

  const HEADERS = [
    "NO FKS","LINK EKATALOG","DEADLINE FKS","MANUFACTURES","DISTRIBUTOR","TGL KLIK",
    "LEMBAGA SATUAN KERJA","RINCIAN ITEM","QTY","KATEGORI ITEM",
    "HARGA ITEMIZED SEBELUM PAJAK","VALUE PRODUK SATUAN INCLUDE TAX","VALUE ONGKIR",
    "TOTAL VALUE PRODUK INCLUDE TAX","TOTAL VALUE ONGKIR","GRAND TOTAL",
  ];
  const lines = [HEADERS.join("\t")];
  window.__tsv = lines;
  let idx = 0, nRows = 0, nWarn = 0;

  for (const o of allOrders) {
    idx++;
    try {
      const resp = await gql({
        query: DETAIL_QUERY,
        variables: { input: { id: o.id, orderKey: o.orderKey } },
        operationName: "getOrderDetailForExport",
      });
      const d = resp?.data?.orderDetailV2;
      if (!d || d.__typename !== "OrderV2") {
        console.warn(`[${idx}/${allOrders.length}] Gagal detail ${o.orderNumber}:`, d, resp?.errors);
        continue;
      }

      // DISTRIBUTOR = reseller (kalau ada), kalau tidak = penyedia langsung
      const distributor =
        d.resellerInfo?.company?.name || d.sellerInfo?.company?.name || "";

      const lembaga =
        d.buyerInfo?.assignedUser?.buyerSnapshot?.institutionName ||
        d.buyerInfo?.assignedUser?.buyerSnapshot?.nameSatuanKerja || "";
      const tglKlik = fmtDate(d.timestamp);

      const groupId = (d.payments || []).find((p) => p.deliveryOrderGroupId)?.deliveryOrderGroupId;
      const deadlineFks = await getDeadlineFks(groupId);

      const ongkirFee = d.shipmentSummary?.totalShipmentFee;       // sebelum pajak
      const ongkirTotal = d.shipmentSummary?.totalShipmentPrice;   // include pajak
      const grandTotal = d.total;

      // subTotal = harga deal x qty + PPN (sudah include pajak)
      const totalProduk = (d.items || []).reduce((s, it) => s + (it.subTotal || 0), 0);
      if (Math.abs(totalProduk + (ongkirTotal || 0) - (grandTotal || 0)) > 5) {
        nWarn++;
        console.warn(`  [CEK] ${d.orderNumber}: produk(${totalProduk}) + ongkir(${ongkirTotal}) != grand total(${grandTotal})`);
      }

      const items = d.items && d.items.length ? d.items : [null];
      for (const it of items) {
        const qty = it?.qty || 0;
        // lastPrice = harga deal (setelah negosiasi); originalPrice = harga tayang
        const hargaSebelumPajak = it ? (it.lastPrice ?? it.originalPrice ?? "") : "";
        // satuan include pajak = subTotal / qty
        const satuanIncTax = it && qty ? (it.subTotal || 0) / qty : "";

        lines.push([
          d.orderNumber,
          LINK_EKATALOG,
          deadlineFks,
          MANUFACTURER,
          distributor,
          tglKlik,
          lembaga,
          it?.snapshot?.name || "",
          it ? qty : "",
          it?.snapshot?.pdn?.type || it?.snapshot?.type || "",
          fmtRp(hargaSebelumPajak),
          fmtRp(satuanIncTax),
          fmtRp(ongkirFee),
          fmtRp(totalProduk),
          fmtRp(ongkirTotal),
          fmtRp(grandTotal),
        ].map(clean).join("\t"));
        nRows++;
      }
      console.log(`[${idx}/${allOrders.length}] OK: ${d.orderNumber} | ${distributor}`);
    } catch (err) {
      console.error(`[${idx}/${allOrders.length}] Error ${o.orderNumber}:`, err);
    }
    await sleep(100);
  }

  if (nRows === 0) { console.error("Tidak ada data untuk di-export."); return; }

  // ---------- 3. Output: langsung ke clipboard ----------
  const tsv = lines.join("\n");
  const tgl = new Date().toISOString().slice(0, 10);

  let copied = false;
  try { copy(tsv); copied = true; }                       // utilitas Console, paling andal
  catch (e) {
    try { await navigator.clipboard.writeText(tsv); copied = true; }
    catch (e2) { /* lanjut ke file */ }
  }

  // Cadangan: file .tsv (tanpa BOM), selalu di-download
  {
    const blob = new Blob([tsv], { type: "text/tab-separated-values" });
    Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `export_order_inaproc_${tgl}.tsv`,
    }).click();
  }

  console.log(
    `Selesai! ${nRows} baris. Order dengan peringatan [CEK]: ${nWarn}. ` +
    (copied
      ? "Sudah ada di clipboard: klik SATU kali sel A1 di Google Sheets, lalu Ctrl+V."
      : "Clipboard gagal, pakai file .tsv yang ter-download (File > Import di Sheets).")
  );
})();