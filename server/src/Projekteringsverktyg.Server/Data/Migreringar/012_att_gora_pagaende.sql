-- Att göra: en rad kan markeras som pågående (förutom åtgärdad/klar).
ALTER TABLE att_gora ADD COLUMN IF NOT EXISTS "Pagaende" boolean NOT NULL DEFAULT false;
