/**
 * SCRIPT INI DIJALANKAN DI CONSOLE BROWSER (F12 -> Console),
 * SAAT ANDA SUDAH LOGIN di https://penyedia.inaproc.id
 *
 * Cara pakai:
 * 1. Buka https://penyedia.inaproc.id/order?status=all (pastikan sudah login)
 * 2. Buka DevTools (F12) -> tab Console
 * 3. Paste seluruh isi file ini, tekan Enter
 * 4. Tunggu proses selesai (akan muncul log progress di console)
 * 5. File CSV otomatis ke-download
 *
 * CATATAN KETERBATASAN DATA:
 * - "LINK EKATALOG" dan "MANUFACTURES" TIDAK tersedia di GraphQL order.
 *   Kedua kolom ini dikosongkan (harus diisi manual dari halaman katalog produk).
 * - productId item disertakan di kolom terpisah supaya memudahkan Anda
 *   mencari link katalog / manufacturer secara manual nantinya.
 * - Nilai per-order (ongkir, total produk, grand total) diulang di setiap
 *   baris item pada order yang sama, supaya CSV tetap "flat" dan gampang
 *   dipivot di Excel.
 */

(async function exportInaprocOrders() {
  const API = "https://penyedia.inaproc.id/graphql";

  async function gql(body) {
    const res = await fetch(API, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} - pastikan Anda sudah login & masih di tab penyedia.inaproc.id`);
    }
    return res.json();
  }

  // ---------- 1. Ambil semua order (list, paginated) ----------
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
        __typename
        currentPage
        lastPage
        perPage
        total
        items {
          orderNumber
          orderKey
          id
          status
          timestamp
        }
      }
      ... on GenericError {
        __typename
        code
        message
      }
    }
  }`;

  let allOrders = [];
  let page = 1;
  let lastPage = 1;

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
    console.log(`Ambil list order... halaman ${page}/${lastPage} (total order sejauh ini: ${allOrders.length})`);
    page++;
  } while (page <= lastPage);

  console.log(`Total order ditemukan: ${allOrders.length}`);

  // ---------- 2. Ambil detail tiap order ----------
  const DETAIL_QUERY = `query getOrderDetailForExport($input: OrderInput!) {
    orderDetailV2(input: $input) {
      ... on OrderV2 {
        __typename
        id
        orderNumber
        orderKey
        timestamp
        expiryTime
        total
        totalWithoutTax
        status
        totalShipment
        items {
          qty
          originalPrice
          lastPrice
          subTotal
          productId
          tax {
            ppnPercentage
            ppnBmPercentage
            ppn
            ppnBm
            taxableRate
          }
          snapshot {
            id
            name
            type
            pdn { type }
            stockUnit { primaryUnit }
          }
        }
        shipmentSummary {
          provider
          service
          totalShipmentFee
          totalShipmentPrice
          totalShipmentPriceWithoutPPN
        }
        payments {
          id
          phase
          deliveryOrderGroupId
          status
        }
        sellerInfo {
          company {
            name
            npwp
          }
        }
        buyerInfo {
          assignedUser {
            buyerSnapshot {
              institutionName
              nameSatuanKerja
            }
          }
        }
      }
      ... on GenericError {
        __typename
        code
        message
        reqId
      }
    }
  }`;

  // Query terpisah untuk ambil "jadwal pengiriman diminta" (requestDateArrival)
  // per delivery order dalam satu order (dipakai untuk kolom DEADLINE FKS)
  const DELIVERY_QUERY = `query getDeliveryOrderListForExport($filter: FilterDeliveryOrderList!, $pagination: Pagination!, $sort: DeliveryOrderListSort) {
    deliveryOrderList(input: { filter: $filter, pagination: $pagination, sort: $sort }) {
      ... on DeliveryOrderList {
        __typename
        deliveryOrders {
          id
          requestDateArrival
          requestDateArrivalStart
          requestDateArrivalEnd
          requestDateArrivalNotes
        }
      }
      ... on GenericError {
        __typename
        code
        message
      }
    }
  }`;

  async function getDeadlineFks(deliveryOrderGroupId) {
    if (!deliveryOrderGroupId) return "";
    try {
      const resp = await gql({
        query: DELIVERY_QUERY,
        variables: {
          filter: { deliveryGroupId: deliveryOrderGroupId },
          pagination: { page: 1, perPage: 10 },
          sort: { direction: "ASCENDING", field: "DELIVERY_NUMBER" },
        },
        operationName: "getDeliveryOrderListForExport",
      });
      const dList = resp?.data?.deliveryOrderList;
      if (!dList || dList.__typename !== "DeliveryOrderList") return "";
      const dates = (dList.deliveryOrders || []).map((doItem) => {
        if (doItem.requestDateArrivalStart && doItem.requestDateArrivalEnd) {
          return `${new Date(doItem.requestDateArrivalStart).toLocaleDateString("id-ID")} - ${new Date(doItem.requestDateArrivalEnd).toLocaleDateString("id-ID")}`;
        }
        if (doItem.requestDateArrival) {
          return new Date(doItem.requestDateArrival).toLocaleDateString("id-ID");
        }
        return "";
      }).filter(Boolean);
      // dedupe biar tidak berulang kalau semua delivery order tanggalnya sama
      return [...new Set(dates)].join("; ");
    } catch (err) {
      console.warn("Gagal ambil requestDateArrival:", err);
      return "";
    }
  }

  const rows = [];
  let idx = 0;

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
        console.warn(`[${idx}/${allOrders.length}] Gagal ambil detail order ${o.orderNumber}:`, d);
        continue;
      }

      const distributor = d.sellerInfo?.company?.name || "";
      const lembaga =
        d.buyerInfo?.assignedUser?.buyerSnapshot?.institutionName ||
        d.buyerInfo?.assignedUser?.buyerSnapshot?.nameSatuanKerja ||
        "";
      const tglKlik = d.timestamp ? new Date(d.timestamp).toLocaleString("id-ID") : "";

      // DEADLINE FKS = jadwal pengiriman yang diminta (request date arrival),
      // diambil dari delivery order group pada payment pertama yang punya groupId
      const deliveryOrderGroupId = (d.payments || []).find((p) => p.deliveryOrderGroupId)?.deliveryOrderGroupId;
      const deadlineFks = await getDeadlineFks(deliveryOrderGroupId);

      const totalOngkirIncludeTax = d.shipmentSummary?.totalShipmentPrice ?? "";
      const grandTotal = d.total ?? "";

      // total produk include tax = jumlah subTotal + ppn + ppnBm semua item
      const totalProdukIncludeTax = (d.items || []).reduce((sum, it) => {
        const ppn = it.tax?.ppn || 0;
        const ppnBm = it.tax?.ppnBm || 0;
        return sum + (it.subTotal || 0) + ppn + ppnBm;
      }, 0);

      if (!d.items || d.items.length === 0) {
        // order tanpa item (jarang terjadi) - tetap catat 1 baris
        rows.push({
          "NO FKS": d.orderNumber,
          "LINK EKATALOG": "",
          "DEADLINE FKS": deadlineFks,
          MANUFACTURES: "",
          DISTRIBUTOR: distributor,
          "TGL KLIK": tglKlik,
          "LEMBAGA SATUAN KERJA": lembaga,
          "RINCIAN ITEM": "",
          QTY: "",
          "KATEGORI ITEM": "",
          "HARGA ITEMIZED SEBELUM PAJAK": "",
          "VALUE PRODUK SATUAN INCLUDE TAX": "",
          "VALUE ONGKIR": d.shipmentSummary?.totalShipmentFee ?? "",
          "TOTAL VALUE PRODUK INCLUDE TAX": totalProdukIncludeTax,
          "TOTAL VALUE ONGKIR": totalOngkirIncludeTax,
          "GRAND TOTAL": grandTotal,
          "_productId (bantu cari link katalog manual)": "",
        });
      } else {
        for (const it of d.items) {
          const qty = it.qty || 0;
          const hargaSebelumPajak = it.originalPrice ?? it.lastPrice ?? "";
          const ppnUnit = qty ? (it.tax?.ppn || 0) / qty : 0;
          const ppnBmUnit = qty ? (it.tax?.ppnBm || 0) / qty : 0;
          const valueProdukSatuanIncludeTax =
            (it.lastPrice || 0) + ppnUnit + ppnBmUnit;

          rows.push({
            "NO FKS": d.orderNumber,
            "LINK EKATALOG": "", // tidak tersedia via API
            "DEADLINE FKS": deadlineFks,
            MANUFACTURES: "", // tidak tersedia via API
            DISTRIBUTOR: distributor,
            "TGL KLIK": tglKlik,
            "LEMBAGA SATUAN KERJA": lembaga,
            "RINCIAN ITEM": it.snapshot?.name || "",
            QTY: qty,
            "KATEGORI ITEM": it.snapshot?.pdn?.type || it.snapshot?.type || "",
            "HARGA ITEMIZED SEBELUM PAJAK": hargaSebelumPajak,
            "VALUE PRODUK SATUAN INCLUDE TAX": valueProdukSatuanIncludeTax,
            "VALUE ONGKIR": d.shipmentSummary?.totalShipmentFee ?? "",
            "TOTAL VALUE PRODUK INCLUDE TAX": totalProdukIncludeTax,
            "TOTAL VALUE ONGKIR": totalOngkirIncludeTax,
            "GRAND TOTAL": grandTotal,
            "_productId (bantu cari link katalog manual)": it.productId || it.snapshot?.id || "",
          });
        }
      }

      console.log(`[${idx}/${allOrders.length}] OK: ${d.orderNumber}`);
    } catch (err) {
      console.error(`[${idx}/${allOrders.length}] Error order ${o.orderNumber}:`, err);
    }

    // jeda kecil supaya tidak membanjiri server
    await new Promise((r) => setTimeout(r, 150));
  }

  // ---------- 3. Generate & download CSV ----------
  if (rows.length === 0) {
    console.error("Tidak ada data untuk di-export.");
    return;
  }

  const headers = Object.keys(rows[0]);
  const escapeCsv = (val) => {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csvLines = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h])).join(",")),
  ];
  const csvContent = csvLines.join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export_order_inaproc_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`Selesai! ${rows.length} baris di-export ke CSV.`);
})();