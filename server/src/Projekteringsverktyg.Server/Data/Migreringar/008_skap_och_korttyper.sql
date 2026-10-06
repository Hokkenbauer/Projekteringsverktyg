-- Apparatskåp: gemensamt skåpregister för Apparatskåp, Kraftberäkning och Modulbeläggning.
-- Data = Apparatskåp-formuläret (ledningsfärger, komponenter i skåpet, specifikation) som JSON.
-- Moduler = Modulbeläggningen (CPU1 och I/O-kort med kanaler som pekar på komponentens Id) som JSON.
-- Kraftberäkningens rader ligger i listrad med Lista = 'kraft-<Id>'.
CREATE TABLE IF NOT EXISTS skap (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Namn" text NOT NULL,
    "Beteckning" text NOT NULL DEFAULT '',
    "Placering" text NOT NULL DEFAULT '',
    "Beskrivning" text NOT NULL DEFAULT '',
    "Data" text NOT NULL DEFAULT '',
    "Moduler" text NOT NULL DEFAULT '',
    "Ordning" integer NOT NULL DEFAULT 0,
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_skap_ProjektId" ON skap ("ProjektId");

-- Korttyper för Modulbeläggning (I/O-kort). Gemensamma för alla projekt.
CREATE TABLE IF NOT EXISTS korttyp (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Namn" text NOT NULL,
    "Beskrivning" text NOT NULL DEFAULT '',
    "AntalKanaler" integer NOT NULL DEFAULT 0,
    "Farg" text NOT NULL DEFAULT '#FFFFFF',
    "BreddMm" double precision NOT NULL DEFAULT 0,
    "StromMa" double precision NOT NULL DEFAULT 0,
    "Ordning" integer NOT NULL DEFAULT 0
);

-- Korttyper från dagens program (DATA\iokortkatalog.xml).
INSERT INTO korttyp ("Id", "Namn", "Beskrivning", "AntalKanaler", "Farg", "BreddMm", "StromMa", "Ordning") VALUES
('0f280ab2-5661-458d-aa6d-2bee33439fbe', 'KL6781', 'KL6781 Bus Terminal, 1-channel communication interface, M-Bus, master', 1, '#ED7D31', 12, 65, 1),
('8e565142-cfa3-439d-94c0-bee2645b054e', 'KL6041', 'KL6041 Bus Terminal, 1-channel communication interface, serial, RS422/RS485', 1, '#ED7D31', 12, 65, 2),
('dba9b8dc-10c8-4ae7-a63e-1a125b9133d3', 'KL6821', 'KL6821 Bus Terminal, 1-channel communication interface, DALI/DALI-2, master/power supply', 1, '#ED7D31', 12, 55, 3),
('34a8eda8-fdab-4e68-b82c-e01526c95ef7', 'KL1408', 'KL1408 Bus Terminal, 8-channel digital input, 24 V DC, 3 ms, 1-wire connection', 8, '#FFC000', 12, 5, 4),
('18b9ff54-cedf-4c86-959b-6ec3c0177799', 'KL1404', 'KL1404 Bus Terminal, 4-channel digital input, 24 V DC, 3 ms, 2-wire connection', 4, '#FFC000', 12, 3, 5),
('b2d0813b-c3cb-4016-95c9-f9a83e8b08a0', 'KL1808', 'KL1808 EtherCAT Terminal, 8-channel digital input, 24 V DC, 3 ms, 2-wire connection', 8, '#FFC000', 12, 15, 6),
('82d38c04-5efd-4469-98e0-8c73297bbb89', 'KL3208-0010', 'KL3208-0010 Bus Terminal, 8-channel analog input, temperature, RTD (Pt1000, NTC), 16 bit', 8, '#92D050', 12, 85, 7),
('5760a23c-c0a9-42c2-b93c-595af881dac3', 'KL3468', 'KL3468 Bus Terminal, 8-channel analog input, voltage, 0…10 V, 12 bit, single-ended', 8, '#92D050', 12, 140, 8),
('ae0758c9-1b5d-4fd2-a8be-f518e5017919', 'KL3464', 'KL3464 Bus Terminal, 4-channel analog input, voltage, 0…10 V, 12 bit, single-ended', 4, '#92D050', 12, 100, 9),
('3fd3e85f-5d10-4884-8c1a-b0b626398e40', 'KL3458', 'KL3458 Bus Terminal, 8-channel analog input, current, 4…20 mA, 12 bit, single-ended', 8, '#92D050', 12, 105, 10),
('ae4543e4-a197-4e84-8978-c491b8d4509e', 'KL3454', 'KL3454 Bus Terminal, 4-channel analog input, current, 4…20 mA, 12 bit, single-ended', 4, '#92D050', 12, 85, 11),
('95a3c60f-5c59-41d1-bd7e-89035ca22466', 'KL4408', 'KL4408 Bus Terminal, 8-channel analog output, voltage, 0…10 V, 12 bit, single-ended', 8, '#4472C4', 12, 20, 12),
('b7692c43-8dee-410b-a1a5-118f7bccea19', 'KL4404', 'KL4404 Bus Terminal, 4-channel analog output, voltage, 0…10 V, 12 bit, single-ended', 4, '#4472C4', 12, 20, 13),
('b64a4ee2-9ad1-4415-87ad-968b7a52790a', 'KM4602', 'KM4602 Bus Terminal module, 4-channel analog output, voltage, 0…10 V, 12 bit, single-ended', 4, '#4472C4', 24, 175, 14),
('8ec0332c-ea81-402b-9256-ae86cffd3e14', 'KL2652', 'KL2652 Bus Terminal, 2-channel relay output, 230 V AC, 300 V DC, 5 A', 2, '#FF0000', 12, 90, 15),
('321bbfe1-9ab5-4356-8c02-72f13bb45d89', 'KM2652', 'KM2652 Bus Terminal module, 2-channel digital output, 230 V AC, 6 A, m/a', 2, '#FF0000', 24, 130, 16),
('c869d3c6-8b0a-46ec-8b78-8f1fc09ce645', 'KL2408', 'KL2408 Bus Terminal, 8-channel digital output, 24 V DC, 0.5 A, 1-wire connection', 8, '#FF0000', 12, 18, 17),
('0364deab-275f-4bec-b78b-c8783da34c8a', 'KL2798', 'KL2798 Bus Terminal, 8-channel solid state relay output, 30 V AC, 48 V DC, 2 A, potential-free', 8, '#FF0000', 12, 80, 18),
('22fffdbc-0daf-433e-a10c-0f305f543427', 'KL9010', 'KL9010 End terminal', 0, '#ED7D31', 12, 0, 19),
('18f648ef-ca71-40df-b6b3-bbb09428426e', 'KL9020', 'KL9020 Terminal bus extension, end terminal', 0, '#ED7D31', 12, 0, 20),
('b8378b60-b83a-48a3-95a8-b8d266e50e04', 'KL9050', 'KL9050 Terminal bus extension, coupler terminal', 0, '#ED7D31', 12, 0, 21),
('e9e612ab-8748-469c-8884-c60b048418af', 'KL9100', 'KL9100 Potential supply terminal, 24 V DC', 0, '#ED7D31', 12, 0, 22),
('5a20d887-2e6b-4751-a6ad-c5d2da00e999', 'KL9400', 'KL9400 Power supply unit terminal for the K-bus', 0, '#ED7D31', 12, 0, 23);
