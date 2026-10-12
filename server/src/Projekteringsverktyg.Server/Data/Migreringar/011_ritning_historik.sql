-- Historik för Placeringsritningar: en kopia av ritningen högst var tionde minut medan man arbetar,
-- så att en ritning kan återställas om något gått fel. Gallras: allt de senaste två dygnen, sedan en per dag i 30 dagar.
CREATE TABLE IF NOT EXISTS ritning_historik (
    "Id" bigserial PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Version" integer NOT NULL,
    "Data" text NOT NULL,
    "Sparad" timestamp with time zone NOT NULL DEFAULT now(),
    "SparadAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_ritning_historik_projekt ON ritning_historik ("ProjektId", "Sparad");
