(async () => {
  const allItems = [];
  let page = 1;
  let lastPage = 1;
  const perPage = 50; // aman, tidak terlalu besar
  const query = `query unreadChatCount($_v1_input: NegotiationListInput!) {
    _v1_negotiationListV2: negotiationListV2(input: $_v1_input) {
      ... on NegotiationListResponse {
        __typename
        currentPage
        lastPage
        perPage
        total
        items {
          shipments { id }
          timestamp
          expiryTime
          orderNumber
          firstItem {
            snapshot {
              createdAt
              description
              id
              name
              slug
              images { imageUrl }
              stockUnit { primaryUnit }
              variants { createdAt id imageUrl optionValues options price sku }
            }
            productVariantId
            qty
            productId
            originalPrice
            notes
            lastPrice
            tax { ppnBm ppn }
          }
          id
          latestTotal
          orderId
          orderKey
          originalTotal
          rowItemCount
          status
          timestamp
          version
          buyer { buyerSnapshot { institutionName } }
          sellerInfo { company { id isUKM name } }
        }
      }
      ... on GenericError { __typename reqId code message }
    }
  }`;

  do {
    const res = await fetch('https://penyedia.inaproc.id/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: {
          _v1_input: {
            filter: { text: '' },
            sort: { field: 'CREATED_AT', direction: 'DESCENDING' },
            pagination: { page, perPage }
          }
        },
        operationName: 'unreadChatCount'
      })
    });
    const json = await res.json();
    const data = json?.data?._v1_negotiationListV2;
    if (!data || data.__typename !== 'NegotiationListResponse') {
      console.error('Gagal ambil data di page', page, json);
      break;
    }
    allItems.push(...data.items);
    lastPage = data.lastPage;
    console.log(`Page ${page}/${lastPage} — ${data.items.length} item diambil`);
    page++;
  } while (page <= lastPage);

  console.log('TOTAL negosiasi:', allItems.length);

  // ---- Helpers ----
  const fmtRp = (n) => (n == null ? '' : 'Rp' + Number(n).toLocaleString('id-ID'));
  const fmtDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return isNaN(d) ? ts : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const clean = (v) => String(v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ').trim();

  // ---- Build rows ----
  const headers = ['No. Order', 'Status', 'Produk', 'Buyer', 'Harga Awal', 'Harga Terakhir', 'Tanggal'];
  const rows = allItems.map(i => ([
    i.orderNumber,
    i.status,
    i.firstItem?.snapshot?.name,
    i.buyer?.buyerSnapshot?.institutionName,
    fmtRp(i.originalTotal),
    fmtRp(i.latestTotal),
    fmtDate(i.timestamp)
  ].map(clean)));

  const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');

  console.log(tsv);

  // Copy to clipboard for pasting into WA / Sheets
  try {
    await navigator.clipboard.writeText(tsv);
    console.log('✅ TSV sudah disalin ke clipboard — tinggal Ctrl+V / Cmd+V ke WA atau Sheets.');
  } catch (e) {
    console.warn('Gagal auto-copy ke clipboard (izin browser?). Salin manual dari log di atas.', e);
  }

  // Also trigger a .tsv file download as backup
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'negosiasi_inaproc.tsv';
  a.click();
})();