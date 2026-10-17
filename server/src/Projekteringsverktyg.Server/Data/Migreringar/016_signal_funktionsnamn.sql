-- Nya namn på I/O-funktioner: VÄRDE → MÄTVÄRDE, START → MANÖVER, STYR → STYRSIGNAL, LÄGE → INDIKERING.
UPDATE komponent SET "Signaler" = (
  SELECT COALESCE(jsonb_agg(
    CASE e->>'funktion'
      WHEN 'VÄRDE' THEN jsonb_set(e, '{funktion}', '"MÄTVÄRDE"')
      WHEN 'START' THEN jsonb_set(e, '{funktion}', '"MANÖVER"')
      WHEN 'STYR' THEN jsonb_set(e, '{funktion}', '"STYRSIGNAL"')
      WHEN 'LÄGE' THEN jsonb_set(e, '{funktion}', '"INDIKERING"')
      ELSE e END ORDER BY o), '[]'::jsonb)::text
  FROM jsonb_array_elements("Signaler"::jsonb) WITH ORDINALITY AS t(e, o))
WHERE "Signaler" LIKE '[%';
