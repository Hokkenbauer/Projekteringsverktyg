using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.DriftkortApi;
using Projekteringsverktyg.Server.FunktionstextApi;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Tests;

public class KomponentFaltTester
{
    [Fact]
    public void Alla_tillatna_falt_kan_skrivas_och_lasas()
    {
        var k = new Komponent();
        foreach (var falt in KomponentFalt.Tillatna)
        {
            KomponentFalt.Satt(k, falt, $"värde-{falt}");
            Assert.Equal($"värde-{falt}", KomponentFalt.Hamta(k, falt));
        }
    }

    [Theory]
    [InlineData("id")]
    [InlineData("projektId")]
    [InlineData("version")]
    [InlineData("")]
    public void Otillatna_falt_avvisas(string falt)
    {
        Assert.False(KomponentFalt.ArTillatet(falt));
        Assert.Throws<ArgumentException>(() => KomponentFalt.Satt(new Komponent(), falt, "x"));
    }

    [Fact]
    public void Varden_trimmas_och_kortas()
    {
        var k = new Komponent();
        KomponentFalt.Satt(k, "beteckning", "  LB01-GT11  ");
        Assert.Equal("LB01-GT11", k.Beteckning);

        KomponentFalt.Satt(k, "beskrivning", new string('a', KomponentFalt.MaxLangd + 50));
        Assert.Equal(KomponentFalt.MaxLangd, k.Beskrivning.Length);
    }
}

public class NarvaroRegisterTester
{
    [Fact]
    public void Visar_varje_anvandare_en_gang_per_projekt()
    {
        var reg = new NarvaroRegister();
        var projekt = Guid.NewGuid();
        var anna = new Anvandare("a", "Anna");

        reg.Satt("anslutning-1", projekt, anna);
        reg.Satt("anslutning-2", projekt, anna); // samma person i två flikar
        reg.Satt("anslutning-3", projekt, new Anvandare("j", "Johan"));

        Assert.Equal(new[] { "Anna", "Johan" }, reg.I(projekt).Select(a => a.Namn).ToArray());
    }

    [Fact]
    public void Byte_av_projekt_returnerar_det_tidigare()
    {
        var reg = new NarvaroRegister();
        var forsta = Guid.NewGuid();
        var andra = Guid.NewGuid();
        var anv = new Anvandare("a", "Anna");

        Assert.Null(reg.Satt("c", forsta, anv));
        Assert.Equal(forsta, reg.Satt("c", andra, anv));
        Assert.Empty(reg.I(forsta));
        Assert.Equal(andra, reg.Ta("c"));
        Assert.Empty(reg.I(andra));
    }
}

public class MigreringTester
{
    [Theory]
    [InlineData("Projekteringsverktyg.Server.Data.Migreringar.001_grund.sql", "001_grund.sql")]
    [InlineData("Projekteringsverktyg.Server.Data.Migreringar._002_att_gora_anteckningar.sql", "_002_att_gora_anteckningar.sql")]
    public void Filnamn_tas_ut_ur_resursnamnet(string resurs, string forvantat) =>
        Assert.Equal(forvantat, Projekteringsverktyg.Server.Data.Migrering.FilNamn(resurs));

    [Fact]
    public void Alla_migreringar_finns_inbaddade_i_nummerordning()
    {
        var namn = typeof(Projekteringsverktyg.Server.Data.Migrering).Assembly.GetManifestResourceNames()
            .Where(n => n.EndsWith(".sql")).Select(Projekteringsverktyg.Server.Data.Migrering.FilNamn).OrderBy(n => n, StringComparer.Ordinal).ToList();
        Assert.Contains("001_grund.sql", namn);
        Assert.Contains("002_att_gora_anteckningar.sql", namn);
        Assert.Equal("001_grund.sql", namn[0]);
    }
}

public class RollTester
{
    [Theory]
    [InlineData("Admin", true)]
    [InlineData("Projektledare", true)]
    [InlineData("System", true)]
    [InlineData("Tekniker", false)]
    [InlineData("Lasare", false)]
    public void Ser_alla_projekt_efter_roll(string roll, bool forvantat) =>
        Assert.Equal(forvantat, Projekteringsverktyg.Server.Data.Roller.SerAllaProjekt(roll));

    [Fact]
    public void Lasare_far_inte_skriva()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(Projekteringsverktyg.Server.Auth.Behorighet.Rattigheter("Lasare"));
        Assert.Contains("\"skriva\":false", json);
        Assert.Contains("\"hanteraAnvandare\":false", json);
    }
}

public class ListmotorTester
{
    [Theory]
    [InlineData("Erik Engström", "EE")]
    [InlineData("Anna Maria Svensson", "AMS")]
    [InlineData("admin", "ADM")]
    [InlineData("", "")]
    public void Initialer_blir_signatur(string namn, string forvantat) =>
        Assert.Equal(forvantat, Projekteringsverktyg.Server.ListApi.ListEndpoints.Initialer(namn));

    [Fact]
    public void Kryss_fyller_och_tommer_datum_och_signatur()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("egenkontroll")!;
        var kol = def.Kolumn("kontrollerad")!;
        var data = new Dictionary<string, string>();
        var dag = new DateOnly(2026, 10, 4);

        Projekteringsverktyg.Server.ListApi.ListEndpoints.Satt(kol, data, "true", "Erik Engström", dag);
        Assert.Equal("true", data["kontrollerad"]);
        Assert.Equal("2026-10-04", data["datum"]);
        Assert.Equal("EE", data["sign"]);

        Projekteringsverktyg.Server.ListApi.ListEndpoints.Satt(kol, data, "false", "Erik Engström", dag);
        Assert.Equal("", data["kontrollerad"]);
        Assert.Equal("", data["datum"]);
        Assert.Equal("", data["sign"]);
    }

    [Fact]
    public void Alla_listor_har_unika_id_och_kolumner()
    {
        var alla = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Alla;
        Assert.Equal(alla.Count, alla.Select(d => d.Id).Distinct().Count());
        foreach (var d in alla)
        {
            Assert.Equal(d.Kolumner.Count, d.Kolumner.Select(k => k.Nyckel).Distinct().Count());
            foreach (var k in d.Kolumner.Where(k => k.Typ == "komponent"))
                Assert.True(KomponentFalt.ArTillatet(k.KomponentFalt!), $"{d.Id}.{k.Nyckel}");
            foreach (var k in d.Kolumner.Where(k => k.SatterDatum is not null || k.SatterSign is not null))
            {
                Assert.NotNull(d.Kolumn(k.SatterDatum ?? k.Nyckel));
                Assert.NotNull(d.Kolumn(k.SatterSign ?? k.Nyckel));
            }
        }
    }

    [Fact]
    public void Brandspjall_visar_bara_brandspjall()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("brandspjall")!;
        Assert.True(Projekteringsverktyg.Server.ListApi.Listdefinitioner.Omfattar(def, "Brandspjäll"));
        Assert.False(Projekteringsverktyg.Server.ListApi.Listdefinitioner.Omfattar(def, "Spjällmotor"));
    }

    [Theory]
    [InlineData("../../hemligt.txt", "hemligt.txt")]
    [InlineData("C:\\mapp\\ritning.pdf", "ritning.pdf")]
    [InlineData("..", "fil")]
    public void Filnamn_rensas(string namn, string forvantat) =>
        Assert.Equal(forvantat, Projekteringsverktyg.Server.FilApi.FilEndpoints.RentNamn(namn));
}

public class MigreringSkyddTester
{
    [Fact]
    public void Alla_skript_overlever_parameterformatering()
    {
        var asm = typeof(Migrering).Assembly;
        foreach (var namn in asm.GetManifestResourceNames().Where(n => n.EndsWith(".sql")))
        {
            using var r = new StreamReader(asm.GetManifestResourceStream(namn)!);
            var sql = r.ReadToEnd();
            Assert.Equal(sql, string.Format(Migrering.Skydda(sql), Array.Empty<object>()));
        }
    }
}

public class MallTester
{
    [Theory]
    [InlineData("LBxx-GT11", "01", "LB01-GT11")]
    [InlineData("LBXX_GT11", "02", "LB02_GT11")]
    [InlineData("LBxx", null, "LBxx")]
    public void Xx_ersatts(string varde, string? med, string forvantat) =>
        Assert.Equal(forvantat, Projekteringsverktyg.Server.KomponentApi.KomponentMallEndpoints.ErsattXx(varde, med));

    [Fact]
    public void Csv_med_dagens_rubriker_las_in()
    {
        var csv = "﻿Beteckning;System;Komponenttyp;Signaltyp;Placering;Beskrivning;Ovrigt;AnslutsTill;Kabeltyp;Produkttyp\nASxx-OS1;AS;Övrigt;DI;;Utlöst överspänningsskydd;Internt;ASxx;;\n\n";
        var rader = Projekteringsverktyg.Server.KomponentApi.KomponentMallEndpoints.LasCsv(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(csv)));
        Assert.Single(rader);
        Assert.Equal("ASxx-OS1", rader[0]["beteckning"]);
        Assert.Equal("Internt", rader[0]["ovrigt"]);
        Assert.Equal("ASxx", rader[0]["anslutsTill"]);
    }

    [Fact]
    public void Kontrollista_hittas_per_kontroll()
    {
        var id = Guid.NewGuid();
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("kontroll-" + id);
        Assert.NotNull(def);
        Assert.Equal("kontroll-" + id, def!.Id);
        Assert.Null(Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("kontroll-inte-ett-id"));
    }

    [Fact]
    public void Grundkataloger_finns() =>
        Assert.Contains("Temperaturgivare", Projekteringsverktyg.Server.Data.Grundkataloger.Hamta("KomponentTyp"));
}

public class RiskTester
{
    [Theory]
    [InlineData("2", "3", "6")]
    [InlineData("1", "", "")]
    [InlineData("x", "2", "")]
    public void Riskvarde_ar_sannolikhet_ganger_konsekvens(string s, string k, string forvantat)
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("risk-produktion")!;
        var kol = def.Kolumn("riskvarde")!;
        Assert.Equal(forvantat, kol.Berakna(new Dictionary<string, string> { ["sannolikhet"] = s, ["konsekvens"] = k }));
    }
}

public class SkapTester
{
    [Fact]
    public void Kraftlista_hittas_per_skap()
    {
        var id = Guid.NewGuid();
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("kraft-" + id);
        Assert.NotNull(def);
        Assert.NotNull(def!.Kolumn("l1"));
    }

    [Fact]
    public void Modulbelaggning_las_och_tal_trasig_json()
    {
        var m = Projekteringsverktyg.Server.SkapApi.SkapEndpoints.LasModuler(
            "{\"cpu1\":\"CX9020\",\"kort\":[{\"id\":\"a\",\"beskrivning\":\"KL1408\",\"antalKanaler\":2,\"farg\":\"#FFC000\",\"breddMm\":12,\"stromMa\":5,\"kanaler\":[{\"komponentId\":\"x\",\"information\":\"\"},{}]}]}");
        Assert.Equal("CX9020", m.Cpu1);
        Assert.Equal(2, m.Kort![0].Kanaler!.Count);
        Assert.Empty(Projekteringsverktyg.Server.SkapApi.SkapEndpoints.LasModuler("inte json").Kort!);
    }
}

public class DriftkortTester
{
    private const string Wns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    private static byte[] MinstaDocx()
    {
        using var m = new MemoryStream();
        using (var zip = new System.IO.Compression.ZipArchive(m, System.IO.Compression.ZipArchiveMode.Create, true))
        {
            void Skriv(string namn, string xml)
            {
                using var w = new StreamWriter(zip.CreateEntry(namn).Open());
                w.Write(xml);
            }
            Skriv("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>""");
            Skriv("word/_rels/document.xml.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>""");
            Skriv("word/document.xml", $$"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{{Wns}}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Allmänt</w:t></w:r></w:p><w:sectPr><w:footerReference w:type="default" r:id="rId1"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgNumType w:start="2"/><w:cols w:num="2" w:sep="1" w:space="159"/><w:docGrid w:linePitch="326"/></w:sectPr></w:body></w:document>""");
        }
        return m.ToArray();
    }

    [Fact]
    public void Flodesbilden_blir_sida_1_i_eget_avsnitt()
    {
        var ut = DriftkortWord.Bygg(MinstaDocx(), [1, 2, 3], [4, 5]);
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(ut));
        Assert.NotNull(zip.GetEntry("word/media/driftkort1.png"));
        Assert.NotNull(zip.GetEntry("word/media/driftkort1.svg"));
        System.Xml.Linq.XNamespace w = Wns;
        var doc = System.Xml.Linq.XDocument.Load(zip.GetEntry("word/document.xml")!.Open());
        var body = doc.Root!.Element(w + "body")!;
        var forsta = body.Elements().First();
        // Sida 1: bilden och ett eget avsnitt med en spalt och sidnummer 1.
        Assert.Contains(forsta.Descendants(), e => e.Name.LocalName == "anchor");
        var sida1 = forsta.Element(w + "pPr")!.Element(w + "sectPr")!;
        Assert.Equal("1", (string?)sida1.Element(w + "pgNumType")!.Attribute(w + "start"));
        Assert.Null(sida1.Element(w + "cols")!.Attribute(w + "num"));
        Assert.NotNull(sida1.Element(w + "footerReference"));
        // Den tomma sidan i mallen är borta, funktionstexten kommer direkt efter och börjar på sida 2.
        Assert.Equal("Allmänt", body.Elements().Skip(1).First().Value);
        Assert.Equal("2", (string?)body.Element(w + "sectPr")!.Element(w + "pgNumType")!.Attribute(w + "start"));
        // Bildens relation finns.
        var rels = System.Xml.Linq.XDocument.Load(zip.GetEntry("word/_rels/document.xml.rels")!.Open());
        Assert.Contains(rels.Root!.Elements(), r => (string?)r.Attribute("Target") == "media/driftkort1.png");
        var typer = System.Xml.Linq.XDocument.Load(zip.GetEntry("[Content_Types].xml")!.Open());
        Assert.Contains(typer.Root!.Elements(), t => (string?)t.Attribute("Extension") == "png");
    }

    [Fact]
    public void Inte_docx_ger_begripligt_fel()
    {
        var fel = Assert.Throws<InvalidDataException>(() => DriftkortWord.Bygg([1, 2, 3], [1], null));
        Assert.Contains(".docx", fel.Message);
    }
}

public class KalkylTester
{
    [Fact]
    public void Antal_och_differens_raknas_fran_komponenterna()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("kalkylmangder")!;
        var komponenter = new List<Komponent>
        {
            new() { Produkttyp = "Temperaturgivare" }, new() { Produkttyp = "temperaturgivare " }, new() { Produkttyp = "Ventil" },
        };
        var data = new Dictionary<string, string> { ["produkt"] = "Temperaturgivare", ["mangd"] = "1 st" };
        Projekteringsverktyg.Server.ListApi.KolumnDef.BeraknaAlla(def.Kolumner, data, komponenter);
        Assert.Equal("2", data["antal"]);
        Assert.Equal("1", data["differens"]);
    }

    [Fact]
    public void Nya_kataloger_finns_inbaddade()
    {
        foreach (var namn in Projekteringsverktyg.Server.DokumentApi.GemensamKatalogEndpoints.Namn.Keys.Where(n => n != "resursplanering"))
            Assert.False(string.IsNullOrEmpty(Projekteringsverktyg.Server.DokumentApi.GemensamKatalogEndpoints.Grund(namn)), namn);
    }
}

public class KopplingTester
{
    [Fact]
    public void Koppling_visar_komponentens_falt()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("modbus")!;
        var k = new Komponent { Beteckning = "VS01-P1", Komponenttyp = "Pump" };
        var data = new Dictionary<string, string> { ["beteckning"] = k.Id.ToString() };
        Projekteringsverktyg.Server.ListApi.KolumnDef.BeraknaAlla(def.Kolumner, data, [k]);
        Assert.Equal("Pump", data["komponenttyp"]);
        Assert.True(def.Kolumn("beteckning")!.Redigerbar);
    }
}

public class SupportTester
{
    [Theory]
    [InlineData("Beckhoff_cx9020_hwen.pdf", "Beckhoff")]
    [InlineData("ABB A43_A44.pdf", "ABB")]
    [InlineData("WILO Modbus RTU.pdf", "WILO")]
    [InlineData("1.pdf", "Övrigt")]
    public void Kategori_gissas_fran_filnamnet(string fil, string kategori) =>
        Assert.Equal(kategori, Projekteringsverktyg.Server.DokumentApi.VerktygEndpoints.Kategori(fil));
}

public class ImportTester
{
    private const string Fil = """
<?xml version="1.0" encoding="utf-8"?>
<ProjektFil xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="1.0">
  <Metadata><Projektnamn>Karlsängskolan</Projektnamn><Projektnummer>P005</Projektnummer><Kund>Bravida</Kund><Ansvarig>HE</Ansvarig></Metadata>
  <Anteckningar>Kom ihåg kanalisation</Anteckningar>
  <AttGoraLista><Rad><Text>Beställ skåp</Text></Rad><Rad><Text></Text></Rad></AttGoraLista>
  <Komponenter>
    <Komponent Id="9c8600f03ff040c49c42e398b8fc6372"><Beteckning>VS01-GT11</Beteckning><Komponenttyp>Givare</Komponenttyp><Signaltyp>AI</Signaltyp></Komponent>
    <Komponent Id="aaaa00f03ff040c49c42e398b8fc6372"><Beteckning>VS01-P1</Beteckning><Komponenttyp>Pump</Komponenttyp><Signaltyp>Modbus RTU</Signaltyp></Komponent>
  </Komponenter>
  <Skyltlista><Rad KomponentId="9c8600f03ff040c49c42e398b8fc6372"><Textfarg>Svart</Textfarg><Skyltfarg>Gul</Skyltfarg></Rad></Skyltlista>
  <Egenkontroll><Rad KomponentId="9c8600f03ff040c49c42e398b8fc6372"><Kontrollerad>true</Kontrollerad><KontrolleradDatum>2026-09-14T00:00:00</KontrolleradDatum><Sign>HE</Sign></Rad></Egenkontroll>
  <ProjektStatus><Rad UppgiftId="d89fe047a2ec4abf86b13323f8d2cafb"><Klart>true</Klart></Rad><Rad UppgiftId="okand"><Klart>false</Klart></Rad></ProjektStatus>
  <Riskbedomning><Rad><TypAvRisk>Arbetsmiljö</TypAvRisk><UpptagenRisk>Fall</UpptagenRisk><Sannolikhet>2</Sannolikhet><Konsekvens>3</Konsekvens></Rad></Riskbedomning>
  <Apparatskap><Skap><Namn>AS01</Namn><Beteckning>AS01</Beteckning><FargDI>Röd</FargDI><Komponenter><Komponent Namn="DIN-PC"><Vald>true</Vald><Information>CX9020</Information></Komponent></Komponenter><Apparatskapsmatt>1000x800</Apparatskapsmatt></Skap></Apparatskap>
  <Kraftberakning><Skap><Namn>AS01</Namn><Rader><Rad><Beteckning>VS01-P1</Beteckning><L1>1.5</L1><L2 xsi:nil="true" /><L3 xsi:nil="true" /></Rad></Rader></Skap></Kraftberakning>
  <Modulbelaggning><Skap><Namn>AS01</Namn><Cpu1Beskrivning>CX9020</Cpu1Beskrivning><Kort><Kort Id="x"><Beskrivning>KL3208</Beskrivning><AntalKanaler>8</AntalKanaler><Farg>#92D050</Farg><BreddMm>12</BreddMm><StromMa>85</StromMa>
    <Kanaler><Kanal><KomponentId>9c8600f03ff040c49c42e398b8fc6372</KomponentId><Information>Fram</Information></Kanal><Kanal /></Kanaler></Kort></Kort></Skap></Modulbelaggning>
  <ModbusRTU><Enhet><Namn>GW1</Namn><IPAdress>10.0.0.5</IPAdress><Laster><Last><Beteckning>VS01-P1</Beteckning><Id>10</Id><KomponentId>aaaa00f03ff040c49c42e398b8fc6372</KomponentId></Last></Laster></Enhet></ModbusRTU>
  <Funktionstexter><Funktionstext Namn="VS01"><Text>Pumpen går</Text></Funktionstext></Funktionstexter>
  <Andringslogg><Rad><Tidpunkt>2026-09-14T08:20:48+02:00</Tidpunkt><Anvandare>HE</Anvandare><Handelse>Sparade projekt</Handelse></Rad></Andringslogg>
</ProjektFil>
""";

    [Fact]
    public void Projektfil_fran_dagens_program_blir_ett_projekt()
    {
        var rubriker = new Dictionary<Guid, string> { [Guid.NewGuid()] = "Förprojektering" };
        var r = Projekteringsverktyg.Server.ImportApi.GammaltProjekt.Las(System.Xml.Linq.XDocument.Parse(Fil.Trim()), "Test", rubriker, "{\"kategorier\":[]}");
        Assert.Equal("Karlsängskolan", r.Projekt.Namn);
        Assert.Equal(2, r.Komponenter.Count);
        var gt11 = r.Komponenter.Single(k => k.Beteckning == "VS01-GT11");
        var p1 = r.Komponenter.Single(k => k.Beteckning == "VS01-P1");
        Assert.NotEqual(Guid.Parse("9c8600f03ff040c49c42e398b8fc6372"), gt11.Id);
        Assert.Contains(r.ListRader, x => x.Lista == "skyltlista" && x.KomponentId == gt11.Id && x.Data.Contains("Gul"));
        Assert.Contains(r.ListRader, x => x.Lista == "egenkontroll" && x.Data.Contains("2026-09-14") && x.Data.Contains("\"kontrollerad\":\"true\""));
        Assert.Contains(r.ListRader, x => x.Lista == "risk-produktion" && x.Data.Contains("Fall"));
        Assert.Contains(r.ListRader, x => x.Lista == "modbus" && x.Data.Contains(p1.Id.ToString()) && x.Data.Contains("GW1"));
        Assert.Contains(r.ListRader, x => x.Lista == "modbusrtu" && x.Data.Contains("10.0.0.5"));
        var skap = Assert.Single(r.Skap);
        Assert.Contains(gt11.Id.ToString(), skap.Moduler);
        Assert.Contains("DIN-PC", skap.Data);
        Assert.Contains(r.ListRader, x => x.Lista == $"kraft-{skap.Id}" && x.Data.Contains("1.5") && !x.Data.Contains("l2"));
        Assert.Single(r.AttGora);
        Assert.Single(r.Status);
        Assert.Single(r.Varningar);
        Assert.Single(r.Dokument, d => d.Typ == "funktionstext" && d.Namn == "VS01");
        Assert.Single(r.Logg);
    }

    [Fact]
    public void Annan_fil_ger_begripligt_fel()
    {
        var fel = Assert.Throws<InvalidDataException>(() => Projekteringsverktyg.Server.ImportApi.GammaltProjekt.Las(
            System.Xml.Linq.XDocument.Parse("<Annat />"), "Test", new Dictionary<Guid, string>(), ""));
        Assert.Contains(".projxml", fel.Message);
    }
}


public class FunktionstextWordTester
{
    private const string Html =
        "<h1>Allmänt</h1><table><tr><td><p>System</p></td><td><p>VS01</p></td></tr><tr><td><p>Styrs av</p></td><td><p>AS01-PLC01</p></td></tr></table>" +
        "<h2>Motorstyrning</h2><p>Pump <b>VS01-P01</b> går i <i>Auto</i> &amp; Hand.</p><ul><li>Kurvan sänks</li><li>Tryck sänks</li></ul><p>Rad 1<br/>Rad 2</p>";

    [Fact]
    public void Text_blir_Word_och_tillbaka_med_rubriker_tabell_lista_och_system()
    {
        var word = WordHtml.TillWord(Html, null);
        var imp = WordHtml.TillHtml(word);
        Assert.Equal("VS01", imp.System);
        Assert.Equal(1, imp.Tabeller);
        Assert.Contains("<h1", imp.Html);
        Assert.Contains(">Allmänt</h1>", imp.Html);
        Assert.Contains(">Motorstyrning</h2>", imp.Html);
        Assert.Contains("<b>VS01-P01</b>", imp.Html);
        Assert.Contains("<i>Auto</i>", imp.Html);
        Assert.Contains("&amp; Hand", imp.Html);
        Assert.Contains("Rad 1<br/>Rad 2", imp.Html);
        Assert.Contains("Kurvan sänks", imp.Html);
        Assert.Contains("<table", imp.Html);
    }

    [Fact]
    public void Importerad_fil_som_mall_behaller_sidfot_och_byter_brodtext()
    {
        var original = WordHtml.TillWord("<p>Gammal text</p>", null);
        var ny = WordHtml.TillWord("<p>Ny text</p>", original);
        var imp = WordHtml.TillHtml(ny);
        Assert.Contains("Ny text", imp.Html);
        Assert.DoesNotContain("Gammal text", imp.Html);
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(ny));
        Assert.NotNull(zip.GetEntry("word/footer1.xml"));
    }

    [Fact]
    public void Ren_text_och_metadata_delas_upp()
    {
        var (meta, html) = WordHtml.Dela("Rad ett\nRad <två>");
        Assert.Null(meta.Kalla);
        Assert.Equal("<p>Rad ett</p><p>Rad &lt;två&gt;</p>", html);
        var sparad = WordHtml.MedMeta("<p>x</p>", new WordHtml.Meta("abc", "VS01"));
        var (m2, h2) = WordHtml.Dela(sparad);
        Assert.Equal("abc", m2.Kalla);
        Assert.Equal("VS01", m2.System);
        Assert.Equal("<p>x</p>", h2);
    }

    [Fact]
    public void Trasig_html_blir_stycken_i_stallet_for_fel()
    {
        var word = WordHtml.TillWord("<p>Öppen <b>tagg</p>", null);
        Assert.Contains("Öppen", WordHtml.TillHtml(word).Html);
    }

    private static readonly System.Xml.Linq.XNamespace Wn = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    private static System.Xml.Linq.XElement Kropp(byte[] docx)
    {
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(docx));
        using var s = zip.GetEntry("word/document.xml")!.Open();
        return System.Xml.Linq.XDocument.Load(s).Root!.Element(Wn + "body")!;
    }

    [Fact]
    public void Driftkort_behaller_typsnitt_tabeller_och_sidbrytningar_efter_import_och_export()
    {
        var original = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Testfiler", "driftkort_struktur.docx"));
        var imp = WordHtml.TillHtml(original);
        var ut = WordHtml.TillWord(imp.Html, original);

        // Resultatet sparas när bygget ber om det, så att det kan granskas (laddas upp som "ordprov").
        if (Environment.GetEnvironmentVariable("ORDPROV_UT") is { Length: > 0 } mapp)
        {
            Directory.CreateDirectory(mapp);
            File.WriteAllBytes(Path.Combine(mapp, "driftkort_export.docx"), ut);
            File.WriteAllText(Path.Combine(mapp, "driftkort_import.html"), imp.Html);
        }

        var fore = Kropp(original);
        var efter = Kropp(ut);
        // Tabbar blir mellanslag och flera mellanslag ett i verktyget, så jämförelsen bortser från blanktecken.
        string Text(System.Xml.Linq.XElement b) => System.Text.RegularExpressions.Regex.Replace(string.Concat(b.Descendants(Wn + "t").Select(t => t.Value)), @"\s+", "");
        // Antal tecken per typsnitt och storlek (körningarna kan delas annorlunda, tecknen ska ha samma format).
        string Format(System.Xml.Linq.XElement b) => string.Join(" ", b.Descendants(Wn + "r").Where(r => r.Element(Wn + "t") is not null)
            .GroupBy(r => ((string?)r.Element(Wn + "rPr")?.Element(Wn + "rFonts")?.Attribute(Wn + "ascii") ?? "-") + "/" +
                          ((string?)r.Element(Wn + "rPr")?.Element(Wn + "sz")?.Attribute(Wn + "val") ?? "-") + "/" +
                          (Pa(r.Element(Wn + "rPr")?.Element(Wn + "b")) ? "b" : "") + (Pa(r.Element(Wn + "rPr")?.Element(Wn + "u")) ? "u" : ""))
            .OrderBy(g => g.Key).Select(g => g.Key + "=" + g.Sum(r => System.Text.RegularExpressions.Regex.Replace(r.Element(Wn + "t")!.Value, @"\s+", "").Length)));
        static bool Pa(System.Xml.Linq.XElement? e) => e is not null && (string?)e.Attribute(Wn + "val") is not ("0" or "false" or "off" or "none");
        string Rakna(System.Xml.Linq.XElement b) =>
            $"p={b.Descendants(Wn + "p").Count()} tbl={b.Descendants(Wn + "tbl").Count()} tcW={b.Descendants(Wn + "tcW").Count()} " +
            $"trHeight={b.Descendants(Wn + "trHeight").Count()} brytningar={b.Descendants(Wn + "br").Count(x => (string?)x.Attribute(Wn + "type") is "page" or "column")} " +
            $"grid={string.Join(",", b.Descendants(Wn + "gridCol").Select(g => (string?)g.Attribute(Wn + "w")))}";

        var t1 = Text(fore); var t2 = Text(efter);
        var forsta = Enumerable.Range(0, Math.Min(t1.Length, t2.Length)).FirstOrDefault(i => t1[i] != t2[i], -1);
        Assert.True(t1 == t2, $"Texten skiljer: {t1.Length} mot {t2.Length} tecken, första skillnad vid {forsta}: " +
            $"'{(forsta >= 0 ? t1.Substring(Math.Max(0, forsta - 20), Math.Min(60, t1.Length - Math.Max(0, forsta - 20))) : "")}' / " +
            $"'{(forsta >= 0 ? t2.Substring(Math.Max(0, forsta - 20), Math.Min(60, t2.Length - Math.Max(0, forsta - 20))) : "")}'");
        Assert.Equal(Rakna(fore), Rakna(efter));
        Assert.Equal(Format(fore), Format(efter));
        int AvFet(System.Xml.Linq.XElement b) => b.Descendants(Wn + "r").Count(r => r.Element(Wn + "t") is not null &&
            (string?)r.Element(Wn + "rPr")?.Element(Wn + "b")?.Attribute(Wn + "val") == "0");
        Assert.True(AvFet(efter) > 0, "Uttryckligen avslagen fetstil (w:b w:val=0) ska följa med");
        Assert.Contains("data-ppr", imp.Html);
    }

    [Fact]
    public void Sparad_formatering_som_pekar_pa_saknad_sidfot_tas_bort_med_standardmall()
    {
        const string html = "<p data-ppr=\"&lt;w:pPr&gt;&lt;w:sectPr&gt;&lt;w:footerReference w:type=&quot;default&quot; r:id=&quot;rId99&quot;/&gt;&lt;/w:sectPr&gt;&lt;/w:pPr&gt;\">Text</p>";
        var ut = WordHtml.TillWord(html, null);
        Assert.Contains(Kropp(ut).Descendants(), x => x.Name.LocalName == "sectPr" && x.Parent?.Name.LocalName == "pPr");
        Assert.DoesNotContain(Kropp(ut).Descendants(), x => x.Name.LocalName == "footerReference" && (string?)x.Attribute(System.Xml.Linq.XName.Get("id", "http://schemas.openxmlformats.org/officeDocument/2006/relationships")) == "rId99");
    }

    [Fact]
    public void Driftkort_kan_byggas_av_text_fran_verktyget()
    {
        var text = WordHtml.TillWord(Html, null);
        var dk = DriftkortWord.Bygg(text, [137, 80, 78, 71], null);
        Assert.True(dk.Length > text.Length);
    }

    [Theory]
    [InlineData("VS01 Driftkort.docx", "VS01")]
    [InlineData("Driftkort_LB02_rev3.docx", "LB02")]
    [InlineData("Funktionstext.docx", null)]
    public void System_ur_filnamn(string fil, string? system) =>
        Assert.Equal(system, FunktionstextEndpoints.SystemIFilnamn(fil));
}


public class DriftkortSidfotTester
{
    private const string Wns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    private static string Cell(params string[] stycken) =>
        "<w:tc>" + string.Concat(stycken.Select(t => $"<w:p><w:r><w:rPr><w:rFonts w:ascii=\"Arial\"/><w:sz w:val=\"14\"/></w:rPr><w:t>{t}</w:t></w:r></w:p>")) + "</w:tc>";

    // Samma uppbyggnad som sidfoten i HECO:s driftkort.
    private static readonly string SidfotXml =
        $"<w:ftr xmlns:w=\"{Wns}\"><w:tbl>" +
        "<w:tr>" + Cell("") + Cell("99999 – Lillkyrka", "Ute på landet", "Adressrad", "Apparatskåp AS01, UC") + Cell("Granskningshandling") + Cell("Projektnummer") + Cell("xyxyxyxy") + "</w:tr>" +
        "<w:tr>" + Cell("Rev") + Cell("Ändring avser") + Cell("Datum") + Cell("Sign") + Cell("Konstruktör") + Cell("Håkan Engström") + "</w:tr>" +
        "<w:tr>" + Cell("") + Cell("") + Cell("") + Cell("") + Cell("Kontrollansvarig") + Cell("Fredrik Danielsson") + "</w:tr>" +
        "<w:tr>" + Cell("") + Cell("") + Cell("") + Cell("") + Cell("Datum") + Cell("2024-05-14") + "</w:tr>" +
        "</w:tbl></w:ftr>";

    private static List<List<string>> Rader(System.Xml.Linq.XElement rot)
    {
        System.Xml.Linq.XNamespace w = Wns;
        return rot.Descendants(w + "tr").Select(tr => tr.Elements(w + "tc")
            .Select(tc => string.Join("|", tc.Elements(w + "p").Select(p => string.Concat(p.Descendants(w + "t").Select(t => t.Value))))).ToList()).ToList();
    }

    [Fact]
    public void Status_datum_och_namn_skrivs_in_men_revisionsrubrikerna_lamnas()
    {
        var rot = System.Xml.Linq.XElement.Parse(SidfotXml);
        var s = new Projekteringsverktyg.Server.DriftkortApi.Sidfot("BYGGHANDLING", "2026-10-15", "12345", "Anna Andersson", "Bo Berg", "12345 – Nya skolan", "Skolvägen 1", null);
        Assert.True(Projekteringsverktyg.Server.DriftkortApi.DriftkortSidfot.Andra(rot, s));
        var r = Rader(rot);
        Assert.Equal("BYGGHANDLING", r[0][2]);
        Assert.Equal("12345 – Nya skolan|Skolvägen 1|Adressrad|Apparatskåp AS01, UC", r[0][1]);
        Assert.Equal("12345", r[0][4]);
        Assert.Equal("Sign", r[1][3]);              // revisionsrubriken "Datum" fick inget värde
        Assert.Equal("Anna Andersson", r[1][5]);
        Assert.Equal("Bo Berg", r[2][5]);
        Assert.Equal("2026-10-15", r[3][5]);
        // Formatet (typsnitt, storlek) i cellen behålls.
        System.Xml.Linq.XNamespace w = Wns;
        Assert.All(rot.Descendants(w + "r").Where(x => x.Element(w + "t") is not null), x => Assert.Equal("14", (string?)x.Element(w + "rPr")?.Element(w + "sz")?.Attribute(w + "val")));
        // En gång till: inget att ändra.
        Assert.False(Projekteringsverktyg.Server.DriftkortApi.DriftkortSidfot.Andra(rot, s));
    }

    [Fact]
    public void Forsta_loggan_i_sidfoten_byts_och_anpassas_in_i_rutan()
    {
        var original = File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Testfiler", "driftkort_struktur.docx"));
        const string png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
        var logga = new Logga("abc123", "Kundlogga", "image/png", 400, 100, png);
        var s = new Sidfot(null, null, null, null, null, null, null, null, ["abc123", null]);
        var ut = DriftkortSidfot.Tillampa(original, s, [logga]);
        Assert.NotSame(original, ut);

        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(ut));
        Assert.NotNull(zip.GetEntry("word/media/pvlogga_abc123.png"));
        System.Xml.Linq.XDocument Las(string n) { using var st = zip.GetEntry(n)!.Open(); return System.Xml.Linq.XDocument.Load(st); }
        System.Xml.Linq.XNamespace a = "http://schemas.openxmlformats.org/drawingml/2006/main";
        System.Xml.Linq.XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        System.Xml.Linq.XNamespace wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
        var fot = Las("word/footer1.xml");
        var blips = fot.Descendants(a + "blip").ToList();
        Assert.Equal("rIdPvLoggaabc123", (string?)blips[0].Attribute(r + "embed"));
        Assert.NotEqual("rIdPvLoggaabc123", (string?)blips[1].Attribute(r + "embed"));   // Logga 2 behålls
        var rels = Las("word/_rels/footer1.xml.rels").ToString();
        Assert.Contains("media/pvlogga_abc123.png", rels);
        var ext = blips[0].Ancestors().First(x => x.Name == wp + "inline" || x.Name == wp + "anchor").Element(wp + "extent")!;
        var forhallande = (double)(long)ext.Attribute("cx")! / (long)ext.Attribute("cy")!;
        Assert.InRange(forhallande, 3.95, 4.05);
        Assert.Contains("Extension=\"png\"", Las("[Content_Types].xml").ToString());
    }

    [Fact]
    public void Tom_sidfot_lamnar_filen_orord()
    {
        var fil = WordHtml.TillWord("<p>x</p>", null);
        Assert.Same(fil, Projekteringsverktyg.Server.DriftkortApi.DriftkortSidfot.Tillampa(fil, new(null, null, null, null, null, null, null, null)));
        Assert.Same(fil, Projekteringsverktyg.Server.DriftkortApi.DriftkortSidfot.Tillampa(fil, new("ARBETSKOPIA", null, null, null, null, null, null, null)));
    }
}
