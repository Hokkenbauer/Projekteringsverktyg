using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.DriftkortApi;
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
        foreach (var namn in Projekteringsverktyg.Server.DokumentApi.GemensamKatalogEndpoints.Namn.Keys)
            Assert.False(string.IsNullOrEmpty(Projekteringsverktyg.Server.DokumentApi.GemensamKatalogEndpoints.Grund(namn)), namn);
    }
}
