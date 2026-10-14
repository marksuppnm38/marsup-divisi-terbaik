(async () => {
  const q = `query($page:Int,$perPage:Int,$filter:ListProductFilterInput){
    listProduct(query:{pagination:{page:$page,perPage:$perPage},filter:$filter}){
      ... on ListProductRes{
        lastPage total
        items{ id name slug status category{name} stockAccumulation
          prices{minPrice maxPrice}
          variants{sku options optionValues price stock isActive} }
      }
      ... on GenericError{ code message }
    }}`;
  const clean = v => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
  const rows = [["product_id","name","slug","status","category","stock_total","min_price","max_price","sku","variant_options","variant_price","variant_stock","variant_active"]];
  let page = 1, last = 1;
  do {
    const r = await fetch("/graphql", {
      method: "POST", credentials: "same-origin",
      headers: {"content-type":"application/json","accept":"application/json"},
      body: JSON.stringify({query:q, variables:{page, perPage:100, filter:{keyword:null,status:["ACTIVE"],categoryIds:[]}}})
    }).then(r => r.json());
    const d = r.data?.listProduct;
    if (!d?.items) { console.error("Gagal:", JSON.stringify(r).slice(0,500)); break; }
    last = d.lastPage;
    for (const p of d.items) {
      const base = [p.id,p.name,p.slug,p.status,p.category?.name,p.stockAccumulation,p.prices?.minPrice,p.prices?.maxPrice];
      const vs = p.variants?.length ? p.variants : [{}];
      for (const v of vs)
        rows.push([...base, v.sku, JSON.stringify(v.optionValues ?? v.options ?? ""), v.price, v.stock, v.isActive].map(clean));
    }
    console.log(`page ${page}/${last}`);
  } while (++page <= last);
  const blob = new Blob([rows.map(r => r.join("\t")).join("\n")], {type:"text/tab-separated-values"});
  const a = Object.assign(document.createElement("a"), {href: URL.createObjectURL(blob), download: "produk_tayang.tsv"});
  a.click();
})();