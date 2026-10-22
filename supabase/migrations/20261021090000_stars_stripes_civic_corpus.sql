-- Apply only to the separate Stars and Stripes project. Legacy table names stay
-- intact so existing tools continue to work; do not repurpose personal records.
ALTER TABLE public.belicia_profile
  ADD COLUMN IF NOT EXISTS office_role text,
  ADD COLUMN IF NOT EXISTS jurisdiction text,
  ADD COLUMN IF NOT EXISTS office_location jsonb;

CREATE TABLE IF NOT EXISTS public.civic_passages (
  id text PRIMARY KEY,
  title text NOT NULL,
  url text NOT NULL CHECK (url LIKE 'https://%'),
  jurisdiction text NOT NULL,
  category text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  effective_date date,
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 10000),
  search_vector tsvector GENERATED ALWAYS AS
    (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(text,''))) STORED
);
CREATE INDEX IF NOT EXISTS civic_passages_search_idx ON public.civic_passages USING gin(search_vector);
ALTER TABLE public.civic_passages ENABLE ROW LEVEL SECURITY;
-- Corpus import and retrieval happen server-side with the service role.
REVOKE ALL ON public.civic_passages FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.search_civic_passages(search_query text, jurisdiction_filter text DEFAULT NULL, result_limit integer DEFAULT 4)
RETURNS TABLE(id text, title text, url text, jurisdiction text, category text, retrieved_at timestamptz, text text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.id, p.title, p.url, p.jurisdiction, p.category, p.retrieved_at, p.text
  FROM public.civic_passages p
  WHERE p.search_vector @@ websearch_to_tsquery('english', left(search_query,1000))
    AND (jurisdiction_filter IS NULL OR lower(p.jurisdiction) = lower(jurisdiction_filter))
  ORDER BY ts_rank(p.search_vector, websearch_to_tsquery('english', left(search_query,1000))) DESC
  LIMIT greatest(1, least(result_limit,8));
$$;
REVOKE ALL ON FUNCTION public.search_civic_passages(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_civic_passages(text,text,integer) TO service_role;
