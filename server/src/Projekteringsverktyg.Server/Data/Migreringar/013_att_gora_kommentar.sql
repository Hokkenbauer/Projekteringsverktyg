-- Att göra: kommentar, t.ex. vad som gjorts när raden åtgärdats.
ALTER TABLE att_gora ADD COLUMN IF NOT EXISTS "Kommentar" text NOT NULL DEFAULT '';
