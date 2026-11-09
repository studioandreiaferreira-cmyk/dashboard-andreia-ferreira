-- Epoch seconds of an ISO timestamp text; NULL when it does not parse (never breaks the snapshot).
CREATE OR REPLACE FUNCTION public.try_epoch(t text) RETURNS bigint
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN round(extract(epoch FROM t::timestamptz));
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
