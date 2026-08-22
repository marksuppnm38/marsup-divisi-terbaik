| table_name         | column_name         | data_type                | character_maximum_length | is_nullable | column_default                              | ordinal_position |
| ------------------ | ------------------- | ------------------------ | ------------------------ | ----------- | ------------------------------------------- | ---------------- |
| allowed_users      | email               | text                     | null                     | NO          | null                                        | 1                |
| allowed_users      | role                | text                     | null                     | NO          | null                                        | 2                |
| allowed_users      | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 3                |
| app_setting        | key                 | text                     | null                     | NO          | null                                        | 1                |
| app_setting        | value               | text                     | null                     | NO          | null                                        | 2                |
| app_setting        | updated_at          | timestamp with time zone | null                     | YES         | now()                                       | 3                |
| konversi_item      | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| konversi_item      | konversi_record_id  | bigint                   | null                     | NO          | null                                        | 2                |
| konversi_item      | produk_id           | bigint                   | null                     | YES         | null                                        | 3                |
| konversi_item      | kode_produk         | text                     | null                     | YES         | null                                        | 4                |
| konversi_item      | nama_produk         | text                     | null                     | YES         | null                                        | 5                |
| konversi_item      | qty                 | integer                  | null                     | NO          | 1                                           | 6                |
| konversi_item      | harga               | numeric                  | null                     | YES         | null                                        | 7                |
| konversi_record    | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| konversi_record    | permintaan_id       | bigint                   | null                     | YES         | null                                        | 2                |
| konversi_record    | tanggal             | date                     | null                     | NO          | CURRENT_DATE                                | 3                |
| konversi_record    | nama_rs             | text                     | null                     | YES         | null                                        | 4                |
| konversi_record    | pic_sales           | text                     | null                     | YES         | null                                        | 5                |
| konversi_record    | pic_marsup          | text                     | null                     | YES         | null                                        | 6                |
| konversi_record    | pagu_total          | numeric                  | null                     | YES         | null                                        | 7                |
| konversi_record    | kategori            | text                     | null                     | YES         | null                                        | 8                |
| konversi_record    | grand_total         | numeric                  | null                     | YES         | null                                        | 9                |
| konversi_record    | notes               | text                     | null                     | YES         | null                                        | 10               |
| konversi_record    | link                | text                     | null                     | YES         | null                                        | 11               |
| konversi_record    | created_by          | uuid                     | null                     | YES         | null                                        | 12               |
| konversi_record    | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 13               |
| konversi_record    | sesi_id             | uuid                     | null                     | YES         | null                                        | 14               |
| konversi_record    | synced_to_sheet     | boolean                  | null                     | NO          | false                                       | 15               |
| konversi_record    | revisi              | integer                  | null                     | NO          | 0                                           | 16               |
| master_produk      | id                  | bigint                   | null                     | NO          | nextval('master_produk_id_seq'::regclass)   | 1                |
| master_produk      | kode_asli           | text                     | null                     | NO          | null                                        | 2                |
| master_produk      | deskripsi_vendor    | text                     | null                     | YES         | null                                        | 3                |
| master_produk      | family              | text                     | null                     | YES         | null                                        | 4                |
| master_produk      | sub_family          | text                     | null                     | YES         | null                                        | 5                |
| master_produk      | manufacturer        | text                     | null                     | YES         | null                                        | 6                |
| master_produk      | capital             | text                     | null                     | YES         | null                                        | 7                |
| master_produk      | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 8                |
| master_produk      | updated_at          | timestamp with time zone | null                     | NO          | now()                                       | 9                |
| permintaan_item    | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| permintaan_item    | permintaan_id       | bigint                   | null                     | NO          | null                                        | 2                |
| permintaan_item    | raw_text            | text                     | null                     | NO          | null                                        | 3                |
| permintaan_item    | qty_diminta         | integer                  | null                     | YES         | null                                        | 4                |
| permintaan_item    | matched_produk_id   | bigint                   | null                     | YES         | null                                        | 5                |
| permintaan_item    | matched_kode_produk | text                     | null                     | YES         | null                                        | 6                |
| permintaan_item    | match_score         | numeric                  | null                     | YES         | null                                        | 7                |
| permintaan_item    | status              | text                     | null                     | NO          | 'PENDING'::text                             | 8                |
| permintaan_item    | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 9                |
| permintaan_item    | catatan             | text                     | null                     | YES         | null                                        | 10               |
| permintaan_item    | pagu_satuan         | numeric                  | null                     | YES         | null                                        | 11               |
| permintaan_rs      | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| permintaan_rs      | tanggal             | date                     | null                     | NO          | CURRENT_DATE                                | 2                |
| permintaan_rs      | nama_rs             | text                     | null                     | YES         | null                                        | 3                |
| permintaan_rs      | pic_sales           | text                     | null                     | YES         | null                                        | 4                |
| permintaan_rs      | sumber              | text                     | null                     | NO          | 'TEKS'::text                                | 5                |
| permintaan_rs      | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 6                |
| permintaan_rs      | pagu                | numeric                  | null                     | YES         | null                                        | 7                |
| permintaan_rs      | tingkat_pemenuhan   | numeric                  | null                     | YES         | null                                        | 8                |
| permintaan_rs      | items_terpenuhi     | integer                  | null                     | YES         | null                                        | 9                |
| permintaan_rs      | items_total         | integer                  | null                     | YES         | null                                        | 10               |
| permintaan_rs      | sesi_id             | uuid                     | null                     | YES         | null                                        | 11               |
| produk             | id                  | bigint                   | null                     | NO          | nextval('produk_id_seq'::regclass)          | 1                |
| produk             | kode_produk         | text                     | null                     | NO          | null                                        | 2                |
| produk             | kode_asli           | text                     | null                     | YES         | null                                        | 3                |
| produk             | nama_produk         | text                     | null                     | YES         | null                                        | 4                |
| produk             | tipe                | text                     | null                     | NO          | null                                        | 5                |
| produk             | no_akd              | text                     | null                     | YES         | null                                        | 6                |
| produk             | masa_berlaku        | date                     | null                     | YES         | null                                        | 7                |
| produk             | golongan            | text                     | null                     | YES         | null                                        | 8                |
| produk             | kode_kfa            | text                     | null                     | YES         | null                                        | 9                |
| produk             | kode_cangkang       | text                     | null                     | YES         | null                                        | 10               |
| produk             | nama_cangkang       | text                     | null                     | YES         | null                                        | 11               |
| produk             | link_v6             | text                     | null                     | YES         | null                                        | 12               |
| produk             | berat_gram          | numeric                  | null                     | YES         | null                                        | 13               |
| produk             | status_v6           | text                     | null                     | YES         | 'DRAFT'::text                               | 14               |
| produk             | is_active           | boolean                  | null                     | NO          | true                                        | 15               |
| produk             | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 16               |
| produk             | updated_at          | timestamp with time zone | null                     | NO          | now()                                       | 17               |
| produk             | spesifikasi         | text                     | null                     | YES         | null                                        | 18               |
| produk             | search_text         | text                     | null                     | YES         | null                                        | 19               |
| produk             | search_tsv          | tsvector                 | null                     | YES         | null                                        | 20               |
| produk_harga       | id                  | bigint                   | null                     | NO          | nextval('produk_harga_id_seq'::regclass)    | 1                |
| produk_harga       | produk_id           | bigint                   | null                     | NO          | null                                        | 2                |
| produk_harga       | tahun               | integer                  | null                     | NO          | null                                        | 3                |
| produk_harga       | jenis               | text                     | null                     | NO          | null                                        | 4                |
| produk_harga       | harga               | numeric                  | null                     | NO          | null                                        | 5                |
| produk_harga       | created_at          | timestamp with time zone | null                     | YES         | now()                                       | 6                |
| produk_harga_v2    | id                  | bigint                   | null                     | NO          | nextval('produk_harga_v2_id_seq'::regclass) | 1                |
| produk_harga_v2    | produk_id           | bigint                   | null                     | NO          | null                                        | 2                |
| produk_harga_v2    | tahun               | integer                  | null                     | NO          | null                                        | 3                |
| produk_harga_v2    | harga_ekat          | numeric                  | null                     | NO          | null                                        | 4                |
| produk_harga_v2    | created_at          | timestamp with time zone | null                     | YES         | now()                                       | 5                |
| produk_harga_v2    | updated_at          | timestamp with time zone | null                     | YES         | now()                                       | 6                |
| produk_media       | id                  | bigint                   | null                     | NO          | nextval('produk_media_id_seq'::regclass)    | 1                |
| produk_media       | produk_id           | bigint                   | null                     | NO          | null                                        | 2                |
| produk_media       | jenis               | text                     | null                     | YES         | null                                        | 3                |
| produk_media       | judul               | text                     | null                     | YES         | null                                        | 4                |
| produk_media       | url                 | text                     | null                     | YES         | null                                        | 5                |
| produk_media       | is_primary          | boolean                  | null                     | YES         | false                                       | 6                |
| produk_media       | urutan              | integer                  | null                     | YES         | 1                                           | 7                |
| produk_set_item    | id                  | bigint                   | null                     | NO          | nextval('produk_set_item_id_seq'::regclass) | 1                |
| produk_set_item    | set_id              | bigint                   | null                     | NO          | null                                        | 2                |
| produk_set_item    | produk_id           | bigint                   | null                     | NO          | null                                        | 3                |
| produk_set_item    | qty                 | integer                  | null                     | NO          | null                                        | 4                |
| produk_set_item    | urutan              | integer                  | null                     | YES         | 1                                           | 5                |
| sales              | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| sales              | nama                | text                     | null                     | NO          | null                                        | 2                |
| sales              | jabatan             | text                     | null                     | YES         | null                                        | 3                |
| sales              | ttd_url             | text                     | null                     | YES         | null                                        | 4                |
| sales              | aktif               | boolean                  | null                     | YES         | true                                        | 5                |
| sales              | created_at          | timestamp with time zone | null                     | YES         | now()                                       | 6                |
| sesi_konversi      | id                  | uuid                     | null                     | NO          | gen_random_uuid()                           | 1                |
| sesi_konversi      | nama_rs             | text                     | null                     | YES         | null                                        | 2                |
| sesi_konversi      | nama_sales          | text                     | null                     | YES         | null                                        | 3                |
| sesi_konversi      | pic_marsup          | text                     | null                     | YES         | null                                        | 4                |
| sesi_konversi      | pagu                | numeric                  | null                     | YES         | null                                        | 5                |
| sesi_konversi      | status              | text                     | null                     | NO          | 'berjalan'::text                            | 6                |
| sesi_konversi      | butuh_bantuan       | boolean                  | null                     | NO          | false                                       | 7                |
| sesi_konversi      | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 8                |
| sesi_konversi      | updated_at          | timestamp with time zone | null                     | NO          | now()                                       | 9                |
| sesi_konversi_item | id                  | uuid                     | null                     | NO          | gen_random_uuid()                           | 1                |
| sesi_konversi_item | sesi_id             | uuid                     | null                     | NO          | null                                        | 2                |
| sesi_konversi_item | kode_produk         | text                     | null                     | NO          | null                                        | 3                |
| sesi_konversi_item | kode_asli           | text                     | null                     | YES         | null                                        | 4                |
| sesi_konversi_item | nama_produk         | text                     | null                     | YES         | null                                        | 5                |
| sesi_konversi_item | tipe                | text                     | null                     | YES         | null                                        | 6                |
| sesi_konversi_item | is_set              | boolean                  | null                     | YES         | false                                       | 7                |
| sesi_konversi_item | produk_id           | uuid                     | null                     | YES         | null                                        | 8                |
| sesi_konversi_item | no_akd              | text                     | null                     | YES         | null                                        | 9                |
| sesi_konversi_item | kode_kfa            | text                     | null                     | YES         | null                                        | 10               |
| sesi_konversi_item | link_v6             | text                     | null                     | YES         | null                                        | 11               |
| sesi_konversi_item | harga_ekat          | numeric                  | null                     | YES         | null                                        | 12               |
| sesi_konversi_item | tahun_harga         | integer                  | null                     | YES         | null                                        | 13               |
| sesi_konversi_item | harga_swasta        | numeric                  | null                     | YES         | null                                        | 14               |
| sesi_konversi_item | tahun_harga_swasta  | integer                  | null                     | YES         | null                                        | 15               |
| sesi_konversi_item | stok_status         | text                     | null                     | YES         | null                                        | 16               |
| sesi_konversi_item | stok_qty            | numeric                  | null                     | YES         | null                                        | 17               |
| sesi_konversi_item | qty                 | numeric                  | null                     | NO          | 1                                           | 18               |
| sesi_konversi_item | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 19               |
| sph_record_items   | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| sph_record_items   | sph_record_id       | bigint                   | null                     | NO          | null                                        | 2                |
| sph_record_items   | kode_produk         | text                     | null                     | YES         | null                                        | 3                |
| sph_record_items   | deskripsi           | text                     | null                     | YES         | null                                        | 4                |
| sph_record_items   | qty                 | numeric                  | null                     | YES         | null                                        | 5                |
| sph_record_items   | harga_satuan        | numeric                  | null                     | YES         | null                                        | 6                |
| sph_record_items   | total               | numeric                  | null                     | YES         | null                                        | 7                |
| sph_records        | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| sph_records        | no_sph              | text                     | null                     | NO          | null                                        | 2                |
| sph_records        | tanggal_surat       | text                     | null                     | YES         | null                                        | 3                |
| sph_records        | distributor         | text                     | null                     | YES         | null                                        | 4                |
| sph_records        | customer            | text                     | null                     | YES         | null                                        | 5                |
| sph_records        | pic_sales           | text                     | null                     | YES         | null                                        | 6                |
| sph_records        | pic_owner           | text                     | null                     | YES         | null                                        | 7                |
| sph_records        | total_value         | numeric                  | null                     | YES         | null                                        | 8                |
| sph_records        | nama_file           | text                     | null                     | YES         | null                                        | 9                |
| sph_records        | status              | text                     | null                     | NO          | 'Terkirim'::text                            | 10               |
| sph_records        | created_at          | timestamp with time zone | null                     | NO          | now()                                       | 11               |
| stg_akd_satuan     | kode_produk         | text                     | null                     | YES         | null                                        | 1                |
| stg_akd_satuan     | kode_asli           | text                     | null                     | YES         | null                                        | 2                |
| stg_akd_satuan     | deskripsi_akd       | text                     | null                     | YES         | null                                        | 3                |
| stg_akd_satuan     | no_akd              | text                     | null                     | YES         | null                                        | 4                |
| stg_akd_satuan     | masa_berlaku        | date                     | null                     | YES         | null                                        | 5                |
| stg_akd_satuan     | golongan            | text                     | null                     | YES         | null                                        | 6                |
| stg_akd_satuan     | tipe                | text                     | null                     | YES         | null                                        | 7                |
| stg_isi_set        | kode_set            | text                     | null                     | YES         | null                                        | 1                |
| stg_isi_set        | deskripsi_set       | text                     | null                     | YES         | null                                        | 2                |
| stg_isi_set        | kode_produk         | text                     | null                     | YES         | null                                        | 3                |
| stg_isi_set        | deskripsi_produk    | text                     | null                     | YES         | null                                        | 4                |
| stg_isi_set        | qty                 | integer                  | null                     | YES         | null                                        | 5                |
| stg_kfa_satuan     | kode_produk         | text                     | null                     | YES         | null                                        | 1                |
| stg_kfa_satuan     | deskripsi           | text                     | null                     | YES         | null                                        | 2                |
| stg_kfa_satuan     | no_akd              | text                     | null                     | YES         | null                                        | 3                |
| stg_kfa_satuan     | nama_cangkang       | text                     | null                     | YES         | null                                        | 4                |
| stg_kfa_satuan     | kode_cangkang       | text                     | null                     | YES         | null                                        | 5                |
| stg_kfa_satuan     | kode_kfa            | text                     | null                     | YES         | null                                        | 6                |
| stg_kfa_satuan     | status_master       | text                     | null                     | YES         | null                                        | 7                |
| stg_list_set       | akd                 | text                     | null                     | YES         | null                                        | 1                |
| stg_list_set       | kode_kfa            | text                     | null                     | YES         | null                                        | 2                |
| stg_list_set       | kode_set            | text                     | null                     | YES         | null                                        | 3                |
| stg_list_set       | deskripsi_set       | text                     | null                     | YES         | null                                        | 4                |
| stg_list_set       | harga_ekat          | numeric                  | null                     | YES         | null                                        | 5                |
| stg_list_set       | link                | text                     | null                     | YES         | null                                        | 6                |
| stg_list_set       | harga_upload        | numeric                  | null                     | YES         | null                                        | 7                |
| stg_list_set       | harga_swasta        | numeric                  | null                     | YES         | null                                        | 8                |
| stg_list_set       | total_qty           | integer                  | null                     | YES         | null                                        | 9                |
| stg_list_set       | berat               | numeric                  | null                     | YES         | null                                        | 10               |
| stg_master_produk  | kode_asli           | text                     | null                     | YES         | null                                        | 1                |
| stg_master_produk  | deskripsi           | text                     | null                     | YES         | null                                        | 2                |
| stg_master_produk  | family              | text                     | null                     | YES         | null                                        | 3                |
| stg_master_produk  | sub_family          | text                     | null                     | YES         | null                                        | 4                |
| stg_master_produk  | sumber              | text                     | null                     | YES         | null                                        | 5                |
| stg_master_produk  | capital             | text                     | null                     | YES         | null                                        | 6                |
| stg_satuan_v6      | kode_produk         | text                     | null                     | YES         | null                                        | 1                |
| stg_satuan_v6      | kode_kfa            | text                     | null                     | YES         | null                                        | 2                |
| stg_satuan_v6      | deskripsi_produk    | text                     | null                     | YES         | null                                        | 3                |
| stg_satuan_v6      | harga_ekat          | numeric                  | null                     | YES         | null                                        | 4                |
| stg_satuan_v6      | harga_upload_v6     | numeric                  | null                     | YES         | null                                        | 5                |
| stg_satuan_v6      | harga_swasta        | numeric                  | null                     | YES         | null                                        | 6                |
| stg_satuan_v6      | harga_v5            | numeric                  | null                     | YES         | null                                        | 7                |
| stg_satuan_v6      | link_v6             | text                     | null                     | YES         | null                                        | 8                |
| stg_satuan_v6      | berat_gram          | numeric                  | null                     | YES         | null                                        | 9                |
| stg_satuan_v6      | spek                | text                     | null                     | YES         | null                                        | 10               |
| stg_satuan_v6      | status              | text                     | null                     | YES         | null                                        | 11               |
| stg_satuan_v6      | kode_asli           | text                     | null                     | YES         | null                                        | 12               |
| stg_satuan_v6      | no_akd              | text                     | null                     | YES         | null                                        | 13               |
| stg_satuan_v6      | kategori_akd        | text                     | null                     | YES         | null                                        | 14               |
| stg_satuan_v6      | masa_berlaku_akd    | text                     | null                     | YES         | null                                        | 15               |
| stg_unit_baru      | id                  | integer                  | null                     | NO          | nextval('stg_unit_baru_id_seq'::regclass)   | 1                |
| stg_unit_baru      | notes               | text                     | null                     | YES         | null                                        | 2                |
| stg_unit_baru      | pabrik              | text                     | null                     | YES         | null                                        | 3                |
| stg_unit_baru      | kode_rnd            | text                     | null                     | YES         | null                                        | 4                |
| stg_unit_baru      | akd_akl             | text                     | null                     | YES         | null                                        | 5                |
| stg_unit_baru      | kode_kfa            | text                     | null                     | YES         | null                                        | 6                |
| stg_unit_baru      | kode_produk         | text                     | null                     | YES         | null                                        | 7                |
| stg_unit_baru      | deskripsi_produk    | text                     | null                     | YES         | null                                        | 8                |
| stg_unit_baru      | harga_satuan        | numeric                  | null                     | YES         | null                                        | 9                |
| stg_unit_baru      | link                | text                     | null                     | YES         | null                                        | 10               |
| stg_unit_baru      | harga_upload_v6     | numeric                  | null                     | YES         | null                                        | 11               |
| stg_unit_baru      | brosur_filename     | text                     | null                     | YES         | null                                        | 12               |
| stg_unit_baru      | jenis_etalase_v6    | text                     | null                     | YES         | null                                        | 13               |
| stg_unit_baru      | link_apa            | text                     | null                     | YES         | null                                        | 14               |
| stg_unit_baru      | harga_swasta        | numeric                  | null                     | YES         | null                                        | 15               |
| stg_unit_baru      | berat_gram          | numeric                  | null                     | YES         | null                                        | 16               |
| stg_unit_baru      | spesifikasi         | text                     | null                     | YES         | null                                        | 17               |
| stg_unit_baru      | kategori_akd        | text                     | null                     | YES         | null                                        | 18               |
| stg_unit_baru      | masa_berlaku_akd    | text                     | null                     | YES         | null                                        | 19               |
| stg_unit_baru      | kategori_produk     | text                     | null                     | YES         | null                                        | 20               |
| stok_produk        | kode_asli           | text                     | null                     | NO          | null                                        | 1                |
| stok_produk        | qty                 | integer                  | null                     | NO          | 0                                           | 2                |
| stok_produk        | updated_at          | timestamp with time zone | null                     | NO          | now()                                       | 3                |
| stok_upload_log    | id                  | bigint                   | null                     | NO          | null                                        | 1                |
| stok_upload_log    | email               | text                     | null                     | NO          | null                                        | 2                |
| stok_upload_log    | uploaded_at         | timestamp with time zone | null                     | NO          | now()                                       | 3                |
| stok_upload_log    | total_rows          | integer                  | null                     | NO          | 0                                           | 4                |
| stok_upload_log    | skipped_count       | integer                  | null                     | NO          | 0                                           | 5                |
| stok_upload_log    | skipped_codes       | jsonb                    | null                     | NO          | '[]'::jsonb                                 | 6                |
| stok_upload_log    | file_name           | text                     | null                     | YES         | null                                        | 7                |
| v_link_update      | count               | bigint                   | null                     | YES         | null                                        | 1                |




| table_name         | column_name        | constraint_type | references_table   | references_column |
| ------------------ | ------------------ | --------------- | ------------------ | ----------------- |
| allowed_users      | email              | PRIMARY KEY     | allowed_users      | email             |
| app_setting        | key                | PRIMARY KEY     | app_setting        | key               |
| konversi_item      | konversi_record_id | FOREIGN KEY     | konversi_record    | id                |
| konversi_item      | produk_id          | FOREIGN KEY     | produk             | id                |
| konversi_item      | id                 | PRIMARY KEY     | konversi_item      | id                |
| konversi_record    | id                 | PRIMARY KEY     | konversi_record    | id                |
| konversi_record    | created_by         | FOREIGN KEY     | null               | null              |
| konversi_record    | permintaan_id      | FOREIGN KEY     | permintaan_rs      | id                |
| konversi_record    | sesi_id            | FOREIGN KEY     | sesi_konversi      | id                |
| master_produk      | id                 | PRIMARY KEY     | master_produk      | id                |
| permintaan_item    | id                 | PRIMARY KEY     | permintaan_item    | id                |
| permintaan_item    | matched_produk_id  | FOREIGN KEY     | produk             | id                |
| permintaan_item    | permintaan_id      | FOREIGN KEY     | permintaan_rs      | id                |
| permintaan_rs      | id                 | PRIMARY KEY     | permintaan_rs      | id                |
| permintaan_rs      | sesi_id            | FOREIGN KEY     | sesi_konversi      | id                |
| produk             | id                 | PRIMARY KEY     | produk             | id                |
| produk_harga       | id                 | PRIMARY KEY     | produk_harga       | id                |
| produk_harga       | produk_id          | FOREIGN KEY     | produk             | id                |
| produk_harga_v2    | id                 | PRIMARY KEY     | produk_harga_v2    | id                |
| produk_harga_v2    | produk_id          | FOREIGN KEY     | produk             | id                |
| produk_media       | produk_id          | FOREIGN KEY     | produk             | id                |
| produk_media       | id                 | PRIMARY KEY     | produk_media       | id                |
| produk_set_item    | produk_id          | FOREIGN KEY     | produk             | id                |
| produk_set_item    | set_id             | FOREIGN KEY     | produk             | id                |
| produk_set_item    | id                 | PRIMARY KEY     | produk_set_item    | id                |
| sales              | id                 | PRIMARY KEY     | sales              | id                |
| sesi_konversi      | id                 | PRIMARY KEY     | sesi_konversi      | id                |
| sesi_konversi_item | id                 | PRIMARY KEY     | sesi_konversi_item | id                |
| sesi_konversi_item | sesi_id            | FOREIGN KEY     | sesi_konversi      | id                |
| sph_record_items   | sph_record_id      | FOREIGN KEY     | sph_records        | id                |
| sph_record_items   | id                 | PRIMARY KEY     | sph_record_items   | id                |
| sph_records        | id                 | PRIMARY KEY     | sph_records        | id                |
| stg_unit_baru      | id                 | PRIMARY KEY     | stg_unit_baru      | id                |
| stok_produk        | kode_asli          | FOREIGN KEY     | master_produk      | kode_asli         |
| stok_produk        | kode_asli          | PRIMARY KEY     | stok_produk        | kode_asli         |
| stok_upload_log    | id                 | PRIMARY KEY     | stok_upload_log    | id                |







| tablename          | indexname                            | indexdef                                                                                                           |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| allowed_users      | allowed_users_pkey                   | CREATE UNIQUE INDEX allowed_users_pkey ON public.allowed_users USING btree (email)                                 |
| app_setting        | app_setting_pkey                     | CREATE UNIQUE INDEX app_setting_pkey ON public.app_setting USING btree (key)                                       |
| konversi_item      | konversi_item_pkey                   | CREATE UNIQUE INDEX konversi_item_pkey ON public.konversi_item USING btree (id)                                    |
| konversi_record    | konversi_record_pkey                 | CREATE UNIQUE INDEX konversi_record_pkey ON public.konversi_record USING btree (id)                                |
| konversi_record    | idx_konversi_record_sesi_id          | CREATE INDEX idx_konversi_record_sesi_id ON public.konversi_record USING btree (sesi_id)                           |
| master_produk      | idx_master_produk_kode               | CREATE INDEX idx_master_produk_kode ON public.master_produk USING btree (kode_asli)                                |
| master_produk      | master_produk_pkey                   | CREATE UNIQUE INDEX master_produk_pkey ON public.master_produk USING btree (id)                                    |
| master_produk      | master_produk_kode_asli_key          | CREATE UNIQUE INDEX master_produk_kode_asli_key ON public.master_produk USING btree (kode_asli)                    |
| permintaan_item    | permintaan_item_pkey                 | CREATE UNIQUE INDEX permintaan_item_pkey ON public.permintaan_item USING btree (id)                                |
| permintaan_rs      | idx_permintaan_rs_sesi_id            | CREATE INDEX idx_permintaan_rs_sesi_id ON public.permintaan_rs USING btree (sesi_id)                               |
| permintaan_rs      | permintaan_rs_pkey                   | CREATE UNIQUE INDEX permintaan_rs_pkey ON public.permintaan_rs USING btree (id)                                    |
| produk             | idx_produk_search_tsv                | CREATE INDEX idx_produk_search_tsv ON public.produk USING gin (search_tsv)                                         |
| produk             | idx_produk_nama_trgm                 | CREATE INDEX idx_produk_nama_trgm ON public.produk USING gist (nama_produk gist_trgm_ops)                          |
| produk             | produk_pkey                          | CREATE UNIQUE INDEX produk_pkey ON public.produk USING btree (id)                                                  |
| produk             | produk_kode_produk_key               | CREATE UNIQUE INDEX produk_kode_produk_key ON public.produk USING btree (kode_produk)                              |
| produk             | idx_produk_kode                      | CREATE INDEX idx_produk_kode ON public.produk USING btree (kode_produk)                                            |
| produk             | idx_produk_kode_asli                 | CREATE INDEX idx_produk_kode_asli ON public.produk USING btree (kode_asli)                                         |
| produk             | idx_produk_tipe                      | CREATE INDEX idx_produk_tipe ON public.produk USING btree (tipe)                                                   |
| produk             | idx_produk_akd                       | CREATE INDEX idx_produk_akd ON public.produk USING btree (no_akd)                                                  |
| produk             | idx_produk_kfa                       | CREATE INDEX idx_produk_kfa ON public.produk USING btree (kode_kfa)                                                |
| produk             | idx_produk_kode_produk               | CREATE INDEX idx_produk_kode_produk ON public.produk USING btree (kode_produk)                                     |
| produk             | idx_produk_search_text_gin           | CREATE INDEX idx_produk_search_text_gin ON public.produk USING gin (search_text gin_trgm_ops)                      |
| produk             | idx_produk_nama_gin                  | CREATE INDEX idx_produk_nama_gin ON public.produk USING gin (nama_produk gin_trgm_ops)                             |
| produk_harga       | produk_harga_pkey                    | CREATE UNIQUE INDEX produk_harga_pkey ON public.produk_harga USING btree (id)                                      |
| produk_harga       | uq_produk_harga                      | CREATE UNIQUE INDEX uq_produk_harga ON public.produk_harga USING btree (produk_id, tahun, jenis)                   |
| produk_harga       | idx_produk_harga_latest              | CREATE INDEX idx_produk_harga_latest ON public.produk_harga USING btree (produk_id, jenis, tahun DESC)             |
| produk_harga_v2    | produk_harga_v2_pkey                 | CREATE UNIQUE INDEX produk_harga_v2_pkey ON public.produk_harga_v2 USING btree (id)                                |
| produk_harga_v2    | produk_harga_v2_produk_id_tahun_key  | CREATE UNIQUE INDEX produk_harga_v2_produk_id_tahun_key ON public.produk_harga_v2 USING btree (produk_id, tahun)   |
| produk_media       | produk_media_pkey                    | CREATE UNIQUE INDEX produk_media_pkey ON public.produk_media USING btree (id)                                      |
| produk_set_item    | produk_set_item_pkey                 | CREATE UNIQUE INDEX produk_set_item_pkey ON public.produk_set_item USING btree (id)                                |
| produk_set_item    | produk_set_item_set_id_produk_id_key | CREATE UNIQUE INDEX produk_set_item_set_id_produk_id_key ON public.produk_set_item USING btree (set_id, produk_id) |
| sales              | sales_pkey                           | CREATE UNIQUE INDEX sales_pkey ON public.sales USING btree (id)                                                    |
| sesi_konversi      | sesi_konversi_pkey                   | CREATE UNIQUE INDEX sesi_konversi_pkey ON public.sesi_konversi USING btree (id)                                    |
| sesi_konversi      | idx_sesi_konversi_status             | CREATE INDEX idx_sesi_konversi_status ON public.sesi_konversi USING btree (status, updated_at DESC)                |
| sesi_konversi_item | sesi_konversi_item_pkey              | CREATE UNIQUE INDEX sesi_konversi_item_pkey ON public.sesi_konversi_item USING btree (id)                          |
| sesi_konversi_item | idx_sesi_item_sesi_id                | CREATE INDEX idx_sesi_item_sesi_id ON public.sesi_konversi_item USING btree (sesi_id)                              |
| sph_record_items   | sph_record_items_pkey                | CREATE UNIQUE INDEX sph_record_items_pkey ON public.sph_record_items USING btree (id)                              |
| sph_records        | sph_records_pkey                     | CREATE UNIQUE INDEX sph_records_pkey ON public.sph_records USING btree (id)                                        |
| stg_unit_baru      | stg_unit_baru_pkey                   | CREATE UNIQUE INDEX stg_unit_baru_pkey ON public.stg_unit_baru USING btree (id)                                    |
| stok_produk        | stok_produk_pkey                     | CREATE UNIQUE INDEX stok_produk_pkey ON public.stok_produk USING btree (kode_asli)                                 |
| stok_upload_log    | stok_upload_log_uploaded_at_idx      | CREATE INDEX stok_upload_log_uploaded_at_idx ON public.stok_upload_log USING btree (uploaded_at DESC)              |
| stok_upload_log    | stok_upload_log_pkey                 | CREATE UNIQUE INDEX stok_upload_log_pkey ON public.stok_upload_log USING btree (id)                                |







| schemaname | tablename          | policyname                                | permissive | roles                | cmd    | qual                                                                                                      | with_check                                                                                                |
| ---------- | ------------------ | ----------------------------------------- | ---------- | -------------------- | ------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| public     | allowed_users      | select_own_row_allowed_users              | PERMISSIVE | {authenticated}      | SELECT | (email = (auth.jwt() ->> 'email'::text))                                                                  | null                                                                                                      |
| public     | konversi_item      | konversi_item_select_authenticated        | PERMISSIVE | {authenticated}      | SELECT | true                                                                                                      | null                                                                                                      |
| public     | konversi_item      | konversi_item_insert_authenticated        | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | true                                                                                                      |
| public     | konversi_record    | konversi_record_update_authenticated      | PERMISSIVE | {authenticated}      | UPDATE | true                                                                                                      | true                                                                                                      |
| public     | konversi_record    | konversi_record_select_authenticated      | PERMISSIVE | {authenticated}      | SELECT | true                                                                                                      | null                                                                                                      |
| public     | konversi_record    | konversi_record_insert_authenticated      | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | true                                                                                                      |
| public     | master_produk      | authenticated_delete_master_produk        | PERMISSIVE | {authenticated}      | DELETE | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) | null                                                                                                      |
| public     | master_produk      | authenticated_update_master_produk        | PERMISSIVE | {authenticated}      | UPDATE | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) | null                                                                                                      |
| public     | master_produk      | authenticated_insert_master_produk        | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) |
| public     | master_produk      | anon_select_master_produk                 | PERMISSIVE | {anon}               | SELECT | true                                                                                                      | null                                                                                                      |
| public     | permintaan_item    | anon_select_permintaan_item               | PERMISSIVE | {anon,authenticated} | SELECT | true                                                                                                      | null                                                                                                      |
| public     | permintaan_rs      | anon_select_permintaan_rs                 | PERMISSIVE | {anon,authenticated} | SELECT | true                                                                                                      | null                                                                                                      |
| public     | produk             | authenticated_delete_produk               | PERMISSIVE | {authenticated}      | DELETE | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) | null                                                                                                      |
| public     | produk             | authenticated_update_produk               | PERMISSIVE | {authenticated}      | UPDATE | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) | null                                                                                                      |
| public     | produk             | allow read produk                         | PERMISSIVE | {public}             | SELECT | true                                                                                                      | null                                                                                                      |
| public     | produk             | anon_select_produk                        | PERMISSIVE | {anon}               | SELECT | true                                                                                                      | null                                                                                                      |
| public     | produk             | authenticated_insert_produk               | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) |
| public     | produk_harga       | authenticated_delete_produk_harga         | PERMISSIVE | {authenticated}      | DELETE | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) | null                                                                                                      |
| public     | produk_harga       | allow read harga                          | PERMISSIVE | {public}             | SELECT | true                                                                                                      | null                                                                                                      |
| public     | produk_harga       | anon_select_produk_harga                  | PERMISSIVE | {anon}               | SELECT | true                                                                                                      | null                                                                                                      |
| public     | produk_harga       | authenticated_insert_produk_harga         | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) |
| public     | produk_harga       | authenticated_update_produk_harga         | PERMISSIVE | {authenticated}      | UPDATE | (EXISTS ( SELECT 1
   FROM allowed_users
  WHERE (allowed_users.email = (auth.jwt() ->> 'email'::text)))) | null                                                                                                      |
| public     | produk_media       | anon insert brosur                        | PERMISSIVE | {anon}               | INSERT | null                                                                                                      | (jenis = 'brosur'::text)                                                                                  |
| public     | produk_media       | anon select brosur                        | PERMISSIVE | {anon}               | SELECT | (jenis = 'brosur'::text)                                                                                  | null                                                                                                      |
| public     | produk_set_item    | allow read set                            | PERMISSIVE | {public}             | SELECT | true                                                                                                      | null                                                                                                      |
| public     | sesi_konversi      | authenticated_full_access                 | PERMISSIVE | {authenticated}      | ALL    | true                                                                                                      | true                                                                                                      |
| public     | sesi_konversi_item | authenticated_full_access                 | PERMISSIVE | {authenticated}      | ALL    | true                                                                                                      | true                                                                                                      |
| public     | sph_record_items   | allowed_users can select sph_record_items | PERMISSIVE | {authenticated}      | SELECT | (auth.email() IN ( SELECT allowed_users.email
   FROM allowed_users))                                     | null                                                                                                      |
| public     | sph_record_items   | allowed_users can insert sph_record_items | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | (auth.email() IN ( SELECT allowed_users.email
   FROM allowed_users))                                     |
| public     | sph_records        | allowed_users can select sph_records      | PERMISSIVE | {authenticated}      | SELECT | (auth.email() IN ( SELECT allowed_users.email
   FROM allowed_users))                                     | null                                                                                                      |
| public     | sph_records        | allowed_users can insert sph_records      | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | (auth.email() IN ( SELECT allowed_users.email
   FROM allowed_users))                                     |
| public     | stok_produk        | anon_select_stok_produk                   | PERMISSIVE | {anon,authenticated} | SELECT | true                                                                                                      | null                                                                                                      |
| public     | stok_upload_log    | authenticated read stok_upload_log        | PERMISSIVE | {authenticated}      | SELECT | true                                                                                                      | null                                                                                                      |
| public     | stok_upload_log    | authenticated insert stok_upload_log      | PERMISSIVE | {authenticated}      | INSERT | null                                                                                                      | true                                                                                                      |





| table_name          | trigger_name               | action_timing | event_manipulation | action_statement                          |
| ------------------- | -------------------------- | ------------- | ------------------ | ----------------------------------------- |
| produk              | produk_search_text_trigger | BEFORE        | INSERT             | EXECUTE FUNCTION trg_update_search_text() |
| produk              | produk_search_text_trigger | BEFORE        | UPDATE             | EXECUTE FUNCTION trg_update_search_text() |
| produk              | trg_generate_search_text   | BEFORE        | INSERT             | EXECUTE FUNCTION generate_search_text()   |
| produk              | trg_generate_search_text   | BEFORE        | UPDATE             | EXECUTE FUNCTION generate_search_text()   |
| produk_dengan_harga | trg_pdh_insert             | INSTEAD OF    | INSERT             | EXECUTE FUNCTION _pdh_insert()            |
| produk_dengan_harga | trg_pdh_update             | INSTEAD OF    | UPDATE             | EXECUTE FUNCTION _pdh_update()            |
| produk_dengan_harga | trg_pdh_delete             | INSTEAD OF    | DELETE             | EXECUTE FUNCTION _pdh_delete()            |