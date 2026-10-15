-- I/O-punkter per komponent (typ, funktion, beskrivning) som JSON. Tom = tolkas ur Signaltyp tills någon ändrar dem.
ALTER TABLE komponent ADD COLUMN IF NOT EXISTS "Signaler" text NOT NULL DEFAULT '';
