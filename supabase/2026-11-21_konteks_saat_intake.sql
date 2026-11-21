-- 2026-11-21 — konteks_minta diisi SAAT MEMASUKKAN permintaan (bukan hanya setelah staff memutuskan produk).
--
-- Konteks = SET / INSTRUMENT / UNIT (lihat KONTEKS di app/pages/konversian/auto-konversi/resolver.js).
-- Diisi lewat select "Jenis" di layar "Periksa item" dan di editor item, supaya resolver Auto-Match sudah
-- terbantu SEBELUM ada keputusan produk.
--
-- Isi file ini:
--   1) submit_permintaan_rs            : menerima items[].konteks, menyimpannya ke permintaan_item.konteks_minta,
--                                         dan mengembalikan konteks_minta di tiap item hasil.
--                                         Signature TIDAK berubah (CREATE OR REPLACE, grant lama tetap).
--   2) update_permintaan_item_konteks_multi (BARU): mengubah/menghapus konteks banyak item sekaligus
--                                         (dipakai editor item dan mode "Tambah item"). Cek allowed_users, sama
--                                         dengan RPC tulis lainnya.
--
-- Prasyarat: kolom permintaan_item.konteks_minta sudah ada (dari migrasi sebelumnya).
-- Tidak menyentuh update_permintaan_item_multi.
--
-- ROLLBACK:
--   drop function if exists public.update_permintaan_item_konteks_multi(jsonb);
--   lalu jalankan ulang definisi lama submit_permintaan_rs (hasil pg_get_functiondef sebelum migrasi ini).

begin;

-- ───────────────────────── 1) submit_permintaan_rs ─────────────────────────
create or replace function public.submit_permintaan_rs(
  p_tanggal date,
  p_nama_rs text,
  p_pic_sales text,
  p_sumber text,
  p_pagu numeric,
  p_items jsonb,
  p_sesi_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_id bigint;
  v_items jsonb;
begin
  if not exists (
    select 1 from allowed_users
    where lower(email) = lower(auth.jwt() ->> 'email')
  ) then
    raise exception 'Tidak diizinkan';
  end if;

  insert into permintaan_rs (tanggal, nama_rs, pic_sales, sumber, pagu, sesi_id)
  values (coalesce(p_tanggal, current_date), p_nama_rs, p_pic_sales,
          coalesce(p_sumber, 'TEKS'), p_pagu, p_sesi_id)
  returning id into v_id;

  -- konteks: hanya SET / INSTRUMENT / UNIT yang diterima; nilai lain / kosong = NULL (konteks tidak diketahui),
  -- sama seperti perlakuan resolver di sisi aplikasi.
  insert into permintaan_item (permintaan_id, raw_text, qty_diminta, pagu_satuan, status, konteks_minta)
  select v_id, (i ->> 'raw_text')::text, nullif(i ->> 'qty', '')::integer,
         nullif(i ->> 'pagu_satuan', '')::numeric, 'PENDING',
         case when upper(trim(i ->> 'konteks')) in ('SET', 'INSTRUMENT', 'UNIT')
              then upper(trim(i ->> 'konteks')) end
  from jsonb_array_elements(p_items) i
  where i ->> 'raw_text' is not null and trim(i ->> 'raw_text') <> '';

  if p_sesi_id is not null then
    update konversi_record
    set permintaan_id = v_id
    where sesi_id = p_sesi_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'raw_text', raw_text, 'qty_diminta', qty_diminta,
    'pagu_satuan', pagu_satuan, 'status', status, 'konteks_minta', konteks_minta
  ) order by id), '[]'::jsonb)
  into v_items
  from permintaan_item where permintaan_id = v_id;

  return jsonb_build_object('permintaan_id', v_id, 'sesi_id', p_sesi_id,
                             'total_items', jsonb_array_length(v_items), 'items', v_items);
end;
$function$;

-- ─────────────── 2) update_permintaan_item_konteks_multi (baru) ───────────────
-- p_rows: [{"id": 123, "konteks": "SET"}, {"id": 124, "konteks": null}, ...]
--   konteks null / "" = hapus konteks (kembali "tidak diketahui").
--   Nilai selain SET / INSTRUMENT / UNIT ditolak (error), bukan diam-diam dikosongkan.
-- Hanya mengubah kolom konteks_minta; status & produk terpilih tidak disentuh.
create or replace function public.update_permintaan_item_konteks_multi(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_n integer;
begin
  if not exists (
    select 1 from allowed_users
    where lower(email) = lower(auth.jwt() ->> 'email')
  ) then
    raise exception 'Tidak diizinkan';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows harus berupa array JSON';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Terlalu banyak baris sekaligus (maks 500)';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) e
    where nullif(trim(e ->> 'konteks'), '') is not null
      and upper(trim(e ->> 'konteks')) not in ('SET', 'INSTRUMENT', 'UNIT')
  ) then
    raise exception 'Konteks harus SET, INSTRUMENT, atau UNIT';
  end if;

  update permintaan_item pi
  set konteks_minta = r.konteks
  from (
    select (e ->> 'id')::bigint as id,
           nullif(upper(trim(e ->> 'konteks')), '') as konteks
    from jsonb_array_elements(p_rows) e
    where e ->> 'id' is not null
  ) r
  where pi.id = r.id;

  get diagnostics v_n = row_count;
  return jsonb_build_object('updated', v_n);
end;
$function$;

-- Fungsi baru: jangan terbuka untuk anon / PUBLIC (cek allowed_users di atas tetap jadi lapis kedua).
revoke all on function public.update_permintaan_item_konteks_multi(jsonb) from public, anon;
grant execute on function public.update_permintaan_item_konteks_multi(jsonb) to authenticated;

commit;

-- ───────────── Verifikasi (jalankan manual setelah migrasi, sebagai user yang login di whitelist) ─────────────
-- select proname, prosecdef, proconfig from pg_proc
--  where proname in ('submit_permintaan_rs', 'update_permintaan_item_konteks_multi');
-- select has_function_privilege('anon', 'public.update_permintaan_item_konteks_multi(jsonb)', 'execute');  -- harus false
