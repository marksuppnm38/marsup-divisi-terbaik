CREATE OR REPLACE FUNCTION public.search_produk_dengan_harga(
    q text,
    p_tipe text DEFAULT NULL::text,
    only_akd boolean DEFAULT false,
    only_kfa boolean DEFAULT false
)
RETURNS TABLE(
    kode_produk text, kode_asli text, nama_produk text, tipe text,
    no_akd text, kode_kfa text, link_v6 text,
    harga_ekat numeric, tahun_harga integer,
    harga_swasta numeric, tahun_harga_swasta integer,
    score double precision
)
LANGUAGE plpgsql
AS $function$
DECLARE
    nq text := normalize_search(q);
    tokens text[] := ARRAY(
        SELECT t
        FROM unnest(string_to_array(nq, ' ')) AS t
        WHERE length(t) >= 2
    );
    token_count int := GREATEST(
        array_length(
            ARRAY(
                SELECT t
                FROM unnest(string_to_array(nq,' ')) AS t
                WHERE length(t)>=2
            ),
            1
        ),
        1
    );
    per_token_cap int := GREATEST(30, 100 / token_count);
    candidate_limit int := 800;   -- NEW: cap before expensive per-token scoring
    tsq_or tsquery;
BEGIN
    IF array_length(tokens,1) IS NULL THEN
        tsq_or := NULL;
    ELSE
        tsq_or := to_tsquery(
            'simple',
            array_to_string(
                ARRAY(
                    SELECT t || ':*'
                    FROM unnest(tokens) t
                ),
                ' | '
            )
        );
    END IF;

    -- ===== NEW: fast-path exact match, skip heavy scoring entirely =====
    IF EXISTS (
        SELECT 1 FROM produk p
        WHERE normalize_search(p.kode_produk) = nq
           OR normalize_search(p.nama_produk) = nq
    ) THEN
        RETURN QUERY
        SELECT
            p.kode_produk,
            p.kode_asli,
            p.nama_produk,
            p.tipe,
            p.no_akd,
            p.kode_kfa,
            p.link_v6,
            ph.harga,
            ph.tahun,
            phs.harga,
            phs.tahun,
            1000::double precision AS score
        FROM produk p
        LEFT JOIN LATERAL (
            SELECT ph2.harga, ph2.tahun
            FROM produk_harga ph2
            WHERE ph2.produk_id = p.id AND ph2.jenis = 'EKATALOG'
            ORDER BY ph2.tahun DESC
            LIMIT 1
        ) ph ON TRUE
        LEFT JOIN LATERAL (
            SELECT ph3.harga, ph3.tahun
            FROM produk_harga ph3
            WHERE ph3.produk_id = p.id AND ph3.jenis = 'SWASTA'
            ORDER BY ph3.tahun DESC
            LIMIT 1
        ) phs ON TRUE
        WHERE
            (normalize_search(p.kode_produk) = nq OR normalize_search(p.nama_produk) = nq)
            AND (p_tipe IS NULL OR UPPER(p.tipe)=UPPER(p_tipe))
            AND (only_akd=FALSE OR p.no_akd IS NOT NULL)
            AND (only_kfa=FALSE OR p.kode_kfa IS NOT NULL)
        LIMIT 5;
        RETURN;
    END IF;
    -- ===== end fast-path =====

    RETURN QUERY
    WITH candidates AS (
        SELECT p.*
        FROM produk p
        WHERE
            (q IS NULL OR tsq_or IS NULL OR p.search_tsv @@ tsq_or)
            AND (p_tipe IS NULL OR UPPER(p.tipe)=UPPER(p_tipe))
            AND (only_akd=FALSE OR p.no_akd IS NOT NULL)
            AND (only_kfa=FALSE OR p.kode_kfa IS NOT NULL)
        ORDER BY
            CASE WHEN tsq_or IS NULL THEN 0 ELSE ts_rank(p.search_tsv, tsq_or) END DESC
        LIMIT candidate_limit    -- NEW: cap BEFORE the token cross join below
    ),
    token_scores AS (
        SELECT
            c.id,
            tok,
            (
                ts_rank(
                    c.search_tsv,
                    to_tsquery('simple', tok || ':*')
                ) * 100
                +
                GREATEST(
                    word_similarity(
                        tok,
                        coalesce(c.nama_produk,'')
                    ),
                    word_similarity(
                        tok,
                        coalesce(c.spesifikasi,'')
                    )
                ) * 30
            ) AS tok_score
        FROM candidates c
        CROSS JOIN unnest(tokens) tok
        WHERE
            c.search_tsv @@ to_tsquery('simple', tok || ':*')
    ),
    totals AS (
        SELECT
            id,
            SUM(tok_score) AS total_score,
            COUNT(DISTINCT tok) AS n_matched
        FROM token_scores
        GROUP BY id
    ),
    per_token_rank AS (
        SELECT
            id,
            tok,
            ROW_NUMBER() OVER (
                PARTITION BY tok
                ORDER BY tok_score DESC
            ) AS rn
        FROM token_scores
    ),
    diversified_ids AS (
        SELECT DISTINCT id
        FROM per_token_rank
        WHERE rn <= per_token_cap

        UNION

        SELECT id
        FROM totals
        WHERE n_matched >= LEAST(token_count, GREATEST(token_count - 1, 1))
    ),
    ranked AS (
        SELECT
            c.*,
            (
                t.total_score
                + CASE
                    WHEN normalize_search(c.kode_produk)=nq
                    THEN 300
                    ELSE 0
                  END
                + CASE
                    WHEN normalize_search(c.nama_produk)=nq
                    THEN 150
                    ELSE 0
                  END
                + CASE
                    WHEN t.n_matched = token_count
                    THEN 80
                    ELSE 0
                  END
            )::double precision
            AS final_score
        FROM candidates c
        JOIN totals t
            ON t.id=c.id
        JOIN diversified_ids d
            ON d.id=c.id
    )
    SELECT
        r.kode_produk,
        r.kode_asli,
        r.nama_produk,
        r.tipe,
        r.no_akd,
        r.kode_kfa,
        r.link_v6,
        ph.harga,
        ph.tahun,
        phs.harga,
        phs.tahun,
        r.final_score
    FROM ranked r
    LEFT JOIN LATERAL (
        SELECT ph2.harga, ph2.tahun
        FROM produk_harga ph2
        WHERE ph2.produk_id=r.id AND ph2.jenis='EKATALOG'
        ORDER BY ph2.tahun DESC
        LIMIT 1
    ) ph ON TRUE
    LEFT JOIN LATERAL (
        SELECT ph3.harga, ph3.tahun
        FROM produk_harga ph3
        WHERE ph3.produk_id=r.id AND ph3.jenis='SWASTA'
        ORDER BY ph3.tahun DESC
        LIMIT 1
    ) phs ON TRUE
    ORDER BY r.final_score DESC
    LIMIT 150;
END;
$function$;