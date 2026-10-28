using Microsoft.EntityFrameworkCore;
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
        // I/O-punkterna (signaler) och inställningarna är JSON och har egna tester (SignalTester, GatewayTester).
        foreach (var falt in KomponentFalt.Tillatna.Where(f => f is not "signaler" and not "installningar"))
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
    [InlineData("Intern", true)]
    [InlineData("Extern", false)]
    public void Ser_alla_projekt_efter_verktygsroll(string roll, bool forvantat) =>
        Assert.Equal(forvantat, Projekteringsverktyg.Server.Data.Roller.SerAllaProjekt(roll));

    [Fact]
    public void Lasare_i_projektet_far_inte_skriva()
    {
        var json = System.Text.Json.JsonSerializer.Serialize(Projekteringsverktyg.Server.Auth.Behorighet.ProjektRattigheter("Lasare"));
        Assert.Contains("\"skriva\":false", json);
        Assert.Contains("\"hanteraMedlemmar\":false", json);
        var pl = System.Text.Json.JsonSerializer.Serialize(Projekteringsverktyg.Server.Auth.Behorighet.ProjektRattigheter("Projektledare"));
        Assert.Contains("\"hanteraMedlemmar\":true", pl);
    }

    [Fact]
    public void Extern_far_bara_skapa_projekt_och_andra_mallar_om_admin_tillater()
    {
        var extern_ = new AnvandarPost { Roll = Roller.Extern };
        Assert.False(Projekteringsverktyg.Server.Auth.Behorighet.FarSkapaProjekt(extern_));
        Assert.False(Projekteringsverktyg.Server.Auth.Behorighet.FarAndraMallar(extern_));
        extern_.FarSkapaProjekt = true;
        Assert.True(Projekteringsverktyg.Server.Auth.Behorighet.FarSkapaProjekt(extern_));
        Assert.True(Projekteringsverktyg.Server.Auth.Behorighet.FarSkapaProjekt(new AnvandarPost { Roll = Roller.Intern }));
        Assert.False(Projekteringsverktyg.Server.Auth.Behorighet.FarAndraMallar(new AnvandarPost { Roll = Roller.Intern }));
    }

    [Fact]
    public async Task Projektroll_galler_bara_i_sitt_projekt()
    {
        using var db = new PvDbContext(new DbContextOptionsBuilder<PvDbContext>().UseInMemoryDatabase("pv-" + Guid.NewGuid()).Options);
        var a = new Projekt { Namn = "A" }; var b = new Projekt { Namn = "B" };
        db.Projekt.AddRange(a, b);
        db.Anvandare.Add(new AnvandarPost { Id = "ext", Namn = "Extern", Roll = Roller.Extern });
        db.Anvandare.Add(new AnvandarPost { Id = "int", Namn = "Intern", Roll = Roller.Intern });
        db.Medlemmar.Add(new ProjektMedlem { ProjektId = a.Id, AnvandarId = "ext", Roll = Roller.Projektledare });
        await db.SaveChangesAsync();
        var ext = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim("oid", "ext"), new System.Security.Claims.Claim("name", "Extern")], "t"));
        var intern = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim("oid", "int"), new System.Security.Claims.Claim("name", "Intern")], "t"));

        var beh = new Projekteringsverktyg.Server.Auth.Behorighet(db);
        Assert.True(await beh.KanLedaProjekt(ext, a.Id));
        Assert.False(await beh.KanLasa(ext, b.Id));
        Assert.False(await beh.ArAdmin(ext));

        var beh2 = new Projekteringsverktyg.Server.Auth.Behorighet(db);
        Assert.True(await beh2.KanLasa(intern, b.Id));
        Assert.False(await beh2.KanSkriva(intern, b.Id));
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
    public void Kontrollmall_med_avsnitt_las_och_sparas()
    {
        var mall = new[] { "Utan avsnitt", "## Start och underlag", "Punkt A", "", "##  Ventilation (VE) ", "Punkt B", "Punkt C" };
        var punkter = Projekteringsverktyg.Server.KontrollApi.KontrollEndpoints.TillPunkter(mall);
        Assert.Equal(4, punkter.Count);
        Assert.Equal(("", "Utan avsnitt"), punkter[0]);
        Assert.Equal(("Start och underlag", "Punkt A"), punkter[1]);
        Assert.Equal(("Ventilation (VE)", "Punkt C"), punkter[3]);

        // Tillbaka till mallrader: en punkt som lagts till sist i ett tidigare avsnitt hamnar i sitt avsnitt.
        var tillbaka = Projekteringsverktyg.Server.KontrollApi.KontrollEndpoints.TillMall(punkter.Append(("Start och underlag", "Punkt D")));
        Assert.Equal(new[] { "Utan avsnitt", "## Start och underlag", "Punkt A", "Punkt D", "## Ventilation (VE)", "Punkt B", "Punkt C" }, tillbaka);
    }

    [Fact]
    public void Kontrollpunkt_ok_komplettering_och_ej_aktuell_utesluter_varandra()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("kontroll-" + Guid.NewGuid())!;
        var data = new Dictionary<string, string>();
        var dag = new DateOnly(2026, 10, 27);
        Projekteringsverktyg.Server.ListApi.ListEndpoints.Satt(def.Kolumn("ejAktuell")!, data, "true", "Håkan Engström", dag);
        Assert.Equal("true", data["ejAktuell"]);
        Assert.Equal("HE", data["sign"]);
        Projekteringsverktyg.Server.ListApi.ListEndpoints.Satt(def.Kolumn("kontrollerad")!, data, "true", "Håkan Engström", dag);
        Assert.Equal("true", data["kontrollerad"]);
        Assert.Equal("", data["ejAktuell"]);
        Assert.True(Projekteringsverktyg.Server.KontrollApi.KontrollEndpoints.ArKlar(data));
        Projekteringsverktyg.Server.ListApi.ListEndpoints.Satt(def.Kolumn("komplettering")!, data, "true", "Håkan Engström", dag);
        Assert.Equal("true", data["komplettering"]);
        Assert.Equal("", data["kontrollerad"]);
        Assert.False(Projekteringsverktyg.Server.KontrollApi.KontrollEndpoints.ArKlar(data));
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

public class SignalTester
{
    [Fact]
    public void Kortform_tolkas_till_IO_punkter_med_foreslagna_funktioner()
    {
        var s = Signaler.Tolka("2DI DU AO RTU");
        Assert.Equal(["DI", "DI", "DU", "AU", "Modbus RTU"], s.Select(x => x.Typ));
        Assert.Equal(["DRIFT", "LARM", "MANÖVER", "STYRSIGNAL", ""], s.Select(x => x.Funktion));
        Assert.Equal("2×DI, DU, AU, Modbus RTU", Signaler.Sammanfatta(s));
        // Sammanfattningen går att tolka tillbaka till samma typer.
        Assert.Equal(s.Select(x => x.Typ), Signaler.Tolka(Signaler.Sammanfatta(s)).Select(x => x.Typ));
    }

    [Theory]
    [InlineData("DI", "DI")]
    [InlineData("di+do", "DI, DU")]
    [InlineData("Modbus RTU", "Modbus RTU")]
    [InlineData("Modbus TCP", "Modbus TCP")]
    [InlineData("M-bus", "M-bus")]
    [InlineData("3 x AI", "3×AI")]
    [InlineData("Givare", "Givare")]
    public void Befintlig_signaltyp_tolkas(string text, string sammanfattning) =>
        Assert.Equal(sammanfattning, Signaler.Sammanfatta(Signaler.Tolka(text)));

    [Fact]
    public void Komponent_utan_sparade_IO_far_punkter_ur_signaltyp_med_fasta_id()
    {
        var k = new Komponent { Beteckning = "LB01-TF01", Signaltyp = "2DI AO" };
        var a = Signaler.Las(k); var b = Signaler.Las(k);
        Assert.Equal(3, a.Count);
        Assert.Equal(a.Select(x => x.Id), b.Select(x => x.Id));
    }

    [Fact]
    public void IO_sparas_som_lista_och_signaltyp_blir_sammanfattning()
    {
        var k = new Komponent { Beteckning = "LB01-TF01" };
        KomponentFalt.Satt(k, "signaler", """[{"id":"a","typ":"DI","funktion":"DRIFT","beskrivning":"Drift"},{"id":"b","typ":"AO","funktion":"VARVTAL","beskrivning":""}]""");
        Assert.Equal("DI, AU", k.Signaltyp);
        var l = Signaler.Las(k);
        Assert.Equal("Drift", l[0].Beskrivning);
        Assert.Equal("AU", l[1].Typ);
        // Signaltyp skriven som text (import, mall) ersätter punkterna.
        KomponentFalt.Satt(k, "signaltyp", "DI DU");
        Assert.Equal("DI, DU", k.Signaltyp);
        Assert.Equal(2, Signaler.Las(k).Count);
        Assert.Throws<ArgumentException>(() => KomponentFalt.Satt(k, "signaler", "[{trasig"));
    }
}

public class ProjektExportTester
{
    [Fact]
    public void Arbetsbok_far_unika_och_korta_bladnamn()
    {
        var fil = Projekteringsverktyg.Server.Export.Excel.Arbetsbok([
            new("Egenkontroll", "t", ["A"], [new object?[] { "x" }]),
            new("Egenkontroll", "t", ["A"], [new object?[] { "y" }]),
            new("Ett väldigt långt namn på en kontroll: el/styr [del 2]", "t", ["A", "B"], []),
        ]);
        using var wb = new ClosedXML.Excel.XLWorkbook(new MemoryStream(fil));
        var namn = wb.Worksheets.Select(w => w.Name).ToList();
        Assert.Equal(3, namn.Count);
        Assert.Equal(namn.Count, namn.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.All(namn, n => Assert.True(n.Length <= 31));
        Assert.Equal("y", wb.Worksheet(2).Cell(5, 1).GetString());
    }
}

public class ProjektExportImportTester
{
    private static PvDbContext NyDb() => new(new DbContextOptionsBuilder<PvDbContext>()
        .UseInMemoryDatabase("pv-" + Guid.NewGuid())
        .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
        .Options);

    [Fact]
    public async Task Export_kan_lasas_in_som_nytt_projekt_med_alla_kopplingar()
    {
        using var db = NyDb();
        var lagring = new Projekteringsverktyg.Server.FilApi.DiskLagring(Path.Combine(Path.GetTempPath(), "pv-test-" + Guid.NewGuid()));
        var p = new Projekt { Namn = "Support Wing", Nummer = "24117", Kund = "Siemens" };
        var k = new Komponent { ProjektId = p.Id, Beteckning = "LB01-TF01", Komponenttyp = "Fläkt" };
        Signaler.Satt(k, Signaler.Tolka("2DI DU AO RTU"));
        var skap = new Skap { ProjektId = p.Id, Namn = "AS01", Moduler = $$"""{"kort":[{"kanaler":[{"komponentId":"{{k.Id}}"}]}]}""" };
        var fil = new ProjektFil { ProjektId = p.Id, Mapp = "Ritningar", Namn = "plan1.pdf", Version = 1, Typ = "application/pdf" };
        fil.BlobNamn = $"{p.Id}/{fil.Id}";
        await lagring.SparaAsync(fil.BlobNamn, new MemoryStream([1, 2, 3]), fil.Typ, CancellationToken.None);
        db.AddRange(p, k, skap, fil,
            new ListRad { ProjektId = p.Id, Lista = "egenkontroll", KomponentId = k.Id, Data = """{"kontrollerad":"true"}""" },
            new Ritning { ProjektId = p.Id, Data = $$"""{"buildings":[{"floors":[{"layers":[{"fileId":"{{fil.Id}}"}],"components":[{"pvId":"{{k.Id}}"}]}]}]}""" },
            new AttGoraPost { ProjektId = p.Id, Text = "Beställ givare" });
        await db.SaveChangesAsync();

        var minne = new MemoryStream();
        using (var zip = new System.IO.Compression.ZipArchive(minne, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
            await Projekteringsverktyg.Server.Export.ProjektExport.SkrivAsync(zip, db, lagring, p, true, true,
                Microsoft.Extensions.Logging.Abstractions.NullLogger.Instance, CancellationToken.None);
        minne.Position = 0;
        using var las = new System.IO.Compression.ZipArchive(minne, System.IO.Compression.ZipArchiveMode.Read);
        Assert.NotNull(las.GetEntry("Projektdata.xlsx"));
        Assert.NotNull(las.GetEntry("Projektfiler/Ritningar/plan1.pdf"));

        var r = await Projekteringsverktyg.Server.Export.ProjektImport.LasInAsync(las, "", new Anvandare("u1", "Test"), "u1", "x.zip", db, lagring, CancellationToken.None);
        Assert.NotEqual(p.Id, r.Projekt.Id);
        Assert.Equal("Support Wing", r.Projekt.Namn);

        var nyK = await db.Komponenter.SingleAsync(x => x.ProjektId == r.Projekt.Id);
        Assert.NotEqual(k.Id, nyK.Id);
        Assert.Equal("2×DI, DU, AU, Modbus RTU", nyK.Signaltyp);
        Assert.Equal(5, Signaler.Las(nyK).Count);
        var nyRad = await db.ListRader.SingleAsync(x => x.ProjektId == r.Projekt.Id);
        Assert.Equal(nyK.Id, nyRad.KomponentId);
        var nyFil = await db.Filer.SingleAsync(x => x.ProjektId == r.Projekt.Id);
        var nyRitning = await db.Ritningar.SingleAsync(x => x.ProjektId == r.Projekt.Id);
        Assert.Contains(nyK.Id.ToString(), nyRitning.Data);
        Assert.Contains(nyFil.Id.ToString(), nyRitning.Data);
        Assert.DoesNotContain(k.Id.ToString(), nyRitning.Data);
        var nyttSkap = await db.Skap.SingleAsync(x => x.ProjektId == r.Projekt.Id);
        Assert.Contains(nyK.Id.ToString(), nyttSkap.Moduler);
        await using (var s = await lagring.OppnaAsync(nyFil.BlobNamn, CancellationToken.None))
        {
            using var m = new MemoryStream(); await s!.CopyToAsync(m);
            Assert.Equal(new byte[] { 1, 2, 3 }, m.ToArray());
        }
        Assert.Equal(1, await db.AttGora.CountAsync(a => a.ProjektId == r.Projekt.Id));
        // Originalet är orört.
        Assert.Equal(k.Id, (await db.ListRader.SingleAsync(x => x.ProjektId == p.Id)).KomponentId);
    }
}

public class AutoRaderTester
{
    private static Komponent K(string bet, string typ = "", string signaler = "") =>
        new() { Beteckning = bet, Komponenttyp = typ, Signaltyp = signaler };

    [Theory]
    [InlineData("VS01-P01", "", true)]
    [InlineData("VS01-PU01", "", true)]
    [InlineData("VS01-PV601", "", true)]
    [InlineData("VS01_P201", "", true)]
    [InlineData("LB01-TF01", "", true)]
    [InlineData("LB01-FF1", "", true)]
    [InlineData("LB01-GT11", "", false)]
    [InlineData("LB01-PT01", "", false)]
    [InlineData("LB01-X1", "Cirkulationspump", true)]
    [InlineData("LB01-TF01", "Fläktvakt", false)]
    public void Laster_kanns_igen_pa_namn_och_typ(string bet, string typ, bool last) =>
        Assert.Equal(last, Projekteringsverktyg.Server.ListApi.AutoRader.ArLast(K(bet, typ)));

    [Theory]
    [InlineData("G-LB01-MQ41", "", "", true)]
    [InlineData("H-KV01-MF41", "", "", true)]
    [InlineData("A1-ME01", "", "", true)]
    [InlineData("LB01-X9", "Elmätare", "", true)]
    [InlineData("LB01-X9", "", "M-bus", true)]
    [InlineData("LB01-GT11", "Temperaturgivare", "AI", false)]
    public void Matare_kanns_igen_pa_mbus_namn_och_typ(string bet, string typ, string sig, bool matare) =>
        Assert.Equal(matare, Projekteringsverktyg.Server.ListApi.AutoRader.ArMatare(K(bet, typ, sig)));

    [Fact]
    public void Matare_far_forslag_pa_medie()
    {
        var d = Projekteringsverktyg.Server.ListApi.AutoRader.MatareForslag(K("G-A1H-MQ51", "Energimätare", "M-bus"));
        Assert.Equal("El", d["medie"]);
        Assert.Equal("M-bus", d["kommunikation"]);
        Assert.Equal("Värme", Projekteringsverktyg.Server.ListApi.AutoRader.MatareForslag(K("G-RAD01-MQ41"))["medie"]);
    }
}

public class InbjudanTester
{
    private static PvDbContext NyDb() => new(new DbContextOptionsBuilder<PvDbContext>()
        .UseInMemoryDatabase("pv-" + Guid.NewGuid()).Options);

    [Fact]
    public void Gastens_anvandarnamn_ger_riktig_epost()
    {
        var user = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim("preferred_username", "Anna.Berg_Foretaget.se#EXT#@heco.onmicrosoft.com")], "test"));
        var e = Projekteringsverktyg.Server.AnvandarApi.Inbjudningar.EpostFran(user);
        Assert.Contains("anna.berg@foretaget.se", e);
    }

    [Fact]
    public async Task Inbjudan_ger_projektroll_men_aldrig_verktygsroll()
    {
        using var db = NyDb();
        var p = new Projekt { Namn = "Husby" };
        db.Projekt.Add(p);
        db.Inbjudningar.Add(new Inbjudan { Epost = "anna@foretaget.se", Roll = Roller.Lasare, ProjektIds = p.Id.ToString(), SkapadAv = "Håkan" });
        await db.SaveChangesAsync();

        var post = new AnvandarPost { Id = "oid-1", Namn = "Anna", Roll = Roller.Extern };
        db.Anvandare.Add(post);
        Assert.True(await Projekteringsverktyg.Server.AnvandarApi.Inbjudningar.TillampaAsync(db, post, new HashSet<string> { "anna@foretaget.se" }));
        await db.SaveChangesAsync();

        // Verktygsrollen ändras aldrig av en inbjudan; projektrollen gäller i projektet.
        Assert.Equal(Roller.Extern, post.Roll);
        Assert.Equal(Roller.Lasare, (await db.Medlemmar.SingleAsync(m => m.ProjektId == p.Id && m.AnvandarId == "oid-1")).Roll);
        Assert.Equal("Accepterad", (await db.Inbjudningar.SingleAsync()).Status);
        // Andra gången händer inget.
        Assert.False(await Projekteringsverktyg.Server.AnvandarApi.Inbjudningar.TillampaAsync(db, post, new HashSet<string> { "anna@foretaget.se" }));
    }
}

public class ProjektKompletteringTester
{
    private static PvDbContext NyDb() => new(new DbContextOptionsBuilder<PvDbContext>()
        .UseInMemoryDatabase("pv-" + Guid.NewGuid())
        .ConfigureWarnings(w => w.Ignore(Microsoft.EntityFrameworkCore.Diagnostics.InMemoryEventId.TransactionIgnoredWarning))
        .Options);

    private static MemoryStream Zip(string json, params (string Sokvag, byte[] Data)[] filer)
    {
        var m = new MemoryStream();
        using (var z = new System.IO.Compression.ZipArchive(m, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            using (var w = new StreamWriter(z.CreateEntry("projekt.json").Open())) w.Write(json);
            foreach (var (s, d) in filer) using (var st = z.CreateEntry(s).Open()) st.Write(d);
        }
        m.Position = 0;
        return m;
    }

    [Fact]
    public async Task Komplettering_uppdaterar_befintligt_och_lagger_till_nytt_utan_dubbletter()
    {
        using var db = NyDb();
        var lagring = new Projekteringsverktyg.Server.FilApi.DiskLagring(Path.Combine(Path.GetTempPath(), "pv-test-" + Guid.NewGuid()));
        var p = new Projekt { Namn = "Karlsängskolan", Nummer = "2025033" };
        var tf = new Komponent { ProjektId = p.Id, Beteckning = "LB01-TF301", Komponenttyp = "Fläkt", Placering = "Fläktrum" };
        db.AddRange(p, tf, new AttGoraPost { ProjektId = p.Id, Text = "Beställ givare", Ordning = 1 });
        await db.SaveChangesAsync();

        // Filens id är andra än projektets: komponenten känns igen på beteckningen.
        var filTf = Guid.NewGuid(); var filGt = Guid.NewGuid(); var filDok = Guid.NewGuid(); var filFil = Guid.NewGuid();
        var json = $$$"""
        {"format":"Projekteringsverktyg projektexport","formatVersion":1,
         "projekt":{"id":"{{{Guid.NewGuid()}}}","namn":"Karlsängskolan","nummer":"2025033","kund":"Bravida"},
         "komponenter":[
           {"id":"{{{filTf}}}","system":"LB01","beteckning":"lb01-tf301","beskrivning":"Tilluftsfläkt","placering":"","signaler":[{"id":"a","typ":"DU","funktion":"MANÖVER","beskrivning":""},{"id":"b","typ":"DI","funktion":"DRIFT","beskrivning":""}]},
           {"id":"{{{filGt}}}","system":"LB01","beteckning":"LB01-GT101","komponenttyp":"Temperaturgivare","signaltyp":"AI"}],
         "listor":{"skyltlista":[{"id":"{{{Guid.NewGuid()}}}","komponentId":"{{{filTf}}}","data":{"textfarg":"Svart"},"ordning":1}]},
         "apparatskap":[{"id":"{{{Guid.NewGuid()}}}","namn":"AS001","placering":"Undercentral","data":{"farger":{"DI":"Röd"}},"ordning":1}],
         "attGora":[{"id":"{{{Guid.NewGuid()}}}","text":"beställ givare"},{"id":"{{{Guid.NewGuid()}}}","text":"Kontrollera VAV-urvalet"}],
         "dokument":[{"id":"{{{filDok}}}","typ":"funktionstext","namn":"VAV.docx","data":"<!--pv {\"Kalla\":\"{{{filFil}}}\",\"System\":\"VAV\"}--><p>Text om {{{filGt}}}</p>"}],
         "texter":{"projektinformation":"Nybyggnad skola"},
         "filer":[{"id":"{{{filFil}}}","mapp":"Funktionstexter","namn":"VAV.docx","typ":"application/octet-stream","sokvag":"Projektfiler/Funktionstexter/VAV.docx"}]}
        """;
        var av = new Anvandare("u1", "Test");

        // Provkörning: rapport men inget sparas.
        using (var zip = new System.IO.Compression.ZipArchive(Zip(json, ("Projektfiler/Funktionstexter/VAV.docx", [1, 2, 3])), System.IO.Compression.ZipArchiveMode.Read))
        {
            var prov = await Projekteringsverktyg.Server.Export.ProjektKomplettering.KompletteraAsync(zip, p.Id, av, "k.zip", true, db, lagring, CancellationToken.None);
            Assert.False(prov.Sparad);
            Assert.Contains(prov.Rapport, r => r.StartsWith("Komponenter: 1 nya, 1 uppdateras"));
        }
        Assert.Equal(1, await db.Komponenter.CountAsync(k => k.ProjektId == p.Id));

        for (var gang = 0; gang < 2; gang++)
        {
            using var zip = new System.IO.Compression.ZipArchive(Zip(json, ("Projektfiler/Funktionstexter/VAV.docx", [1, 2, 3])), System.IO.Compression.ZipArchiveMode.Read);
            var r = await Projekteringsverktyg.Server.Export.ProjektKomplettering.KompletteraAsync(zip, p.Id, av, "k.zip", false, db, lagring, CancellationToken.None);
            Assert.True(r.Sparad);
        }

        var komp = await db.Komponenter.Where(k => k.ProjektId == p.Id).ToListAsync();
        Assert.Equal(2, komp.Count);
        var befintlig = komp.Single(k => k.Id == tf.Id);
        Assert.Equal("Tilluftsfläkt", befintlig.Beskrivning);
        Assert.Equal("LB01-TF301", befintlig.Beteckning);       // stavningen behålls
        Assert.Equal("Fläktrum", befintlig.Placering);          // tomt fält i filen tömmer inte
        Assert.Equal("Fläkt", befintlig.Komponenttyp);
        Assert.Equal("DI, DU", befintlig.Signaltyp);
        var gt = komp.Single(k => k.Beteckning == "LB01-GT101");
        Assert.Equal("AI", gt.Signaltyp);

        var rad = await db.ListRader.SingleAsync(x => x.ProjektId == p.Id && x.Lista == "skyltlista");
        Assert.Equal(tf.Id, rad.KomponentId);
        Assert.Single(await db.Skap.Where(x => x.ProjektId == p.Id).ToListAsync());
        Assert.Equal(2, await db.AttGora.CountAsync(x => x.ProjektId == p.Id));
        var fil = await db.Filer.SingleAsync(x => x.ProjektId == p.Id);   // samma innehåll andra gången = ingen ny version
        var dok = await db.Dokument.SingleAsync(x => x.ProjektId == p.Id);
        Assert.Contains(fil.Id.ToString(), dok.Data);
        Assert.Contains(gt.Id.ToString(), dok.Data);
        Assert.Equal("Nybyggnad skola", (await db.Texter.SingleAsync(x => x.ProjektId == p.Id && x.Nyckel == "projektinformation")).Text);
        Assert.Equal("Bravida", (await db.Projekt.SingleAsync(x => x.Id == p.Id)).Kund);   // tomt fält i projektet fylls i
    }
}

public class FunktionstextSamladTester
{
    [Fact]
    public void Flera_texter_blir_en_Word_fil_med_sidbrytning_mellan()
    {
        var html = string.Join("<p><br data-w=\"page\"/></p>", ["<h1>VS01</h1><p>Text ett</p>", "<h1>LB01</h1><p>Text två</p>"]);
        var fil = WordHtml.TillWord(html, null);
        using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(fil));
        using var r = new StreamReader(zip.GetEntry("word/document.xml")!.Open());
        var xml = r.ReadToEnd();
        Assert.Contains("Text ett", xml);
        Assert.Contains("Text två", xml);
        Assert.Contains("w:type=\"page\"", xml);
    }
}

public class AtaTester
{
    [Fact]
    public void ATA_far_fast_lopnummer_efter_hogsta()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("ata")!;
        var data = new Dictionary<string, string>();
        Projekteringsverktyg.Server.ListApi.ListEndpoints.SattNummer(def, data, []);
        Assert.Equal("Ä001", data["nr"]);
        var befintliga = new[] { new ListRad { Data = "{\"nr\":\"Ä001\"}" }, new ListRad { Data = "{\"nr\":\"Ä007\"}" } };
        Projekteringsverktyg.Server.ListApi.ListEndpoints.SattNummer(def, data, befintliga);
        Assert.Equal("Ä008", data["nr"]);
    }

    [Fact]
    public void ATA_status_ar_ett_val_at_gangen()
    {
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("ata")!;
        var data = new Dictionary<string, string> { ["ejBestalld"] = "true" };
        Projekteringsverktyg.Server.ListApi.ListEndpoints.Satt(def.Kolumn("bestalld")!, data, "true", "Håkan Engström", DateOnly.FromDateTime(DateTime.Today));
        Assert.Equal("true", data["bestalld"]);
        Assert.Equal("", data["ejBestalld"]);
    }
}

public class GatewayTester
{
    private static Komponent K(string beteckning, string anslutsTill, string typ = "", string signaltyp = "", string inst = "")
    {
        var k = new Komponent { Beteckning = beteckning, AnslutsTill = anslutsTill, Komponenttyp = typ, Installningar = inst };
        if (signaltyp != "") KomponentFalt.Satt(k, "signaltyp", signaltyp);
        return k;
    }

    private const string Moxa = """{"typ":"GW-MB-RTU","ip":"10.0.0.5","portar":[{"namn":"Port1","tcpPort":"1501","baudrate":"9600","paritet":"Even","databitar":"8","stopbit":"1"},{"namn":"Port2","tcpPort":"1502","baudrate":"19200","paritet":"None","databitar":"","stopbit":"2"}]}""";

    [Fact]
    public void Slavadresser_per_gateway_borjar_pa_10()
    {
        var gw1 = K("GW1", "AS01", Gateways.Komponenttyp, "Modbus TCP", Moxa);
        var gw2 = K("GW2", "AS01", Gateways.Komponenttyp, "Modbus TCP", Moxa);
        var a = K("R10-GT501", "GW1-Port2", "Rumsregulator", "Modbus RTU");
        var b = K("R2-GT501", "GW1-Port1", "Rumsregulator", "Modbus RTU");
        var c = K("R2-ST401", "R2-GT501", "Spjällställdon", "Modbus RTU");
        var d = K("R3-GT501", "GW2-Port1", "Rumsregulator", "Modbus RTU");
        var t = K("AS01-TCP", "GW2-Port1", "Mätare", "Modbus TCP");
        var alla = new List<Komponent> { gw1, gw2, a, b, c, d, t };
        var rad = alla.ToDictionary(k => k, _ => Guid.NewGuid());
        var enheter = new[] { a, b, c, d, t }.Select(k => (rad[k], k, "")).ToList();

        var nya = Gateways.Slavadresser(enheter, alla, omNumrera: false);
        // GW1: Port1 först (R2-GT501, R2-ST401), sedan Port2 (R10-GT501). GW2 börjar om på 10. TCP får ingen.
        Assert.Equal("10", nya[rad[b]]);
        Assert.Equal("11", nya[rad[c]]);
        Assert.Equal("12", nya[rad[a]]);
        Assert.Equal("10", nya[rad[d]]);
        Assert.False(nya.ContainsKey(rad[t]));

        // Befintliga adresser lämnas; en ny enhet får nästa lediga.
        var med = new List<(Guid, Komponent, string)> { (rad[b], b, "10"), (rad[c], c, ""), (rad[a], a, "12") };
        Assert.Equal(new Dictionary<Guid, string> { [rad[c]] = "11" }, Gateways.Slavadresser(med, alla, false));
        // Numrera om: alla i ordning, bara ändrade returneras.
        var om = Gateways.Slavadresser(new List<(Guid, Komponent, string)> { (rad[b], b, "10"), (rad[c], c, "15"), (rad[a], a, "11") }, alla, true);
        Assert.Equal(new Dictionary<Guid, string> { [rad[c]] = "11", [rad[a]] = "12" }, om);
    }

    [Fact]
    public void Naturlig_ordning_jamfor_tal_som_tal()
    {
        var l = new List<string> { "R10", "R2", "R1001", "r101", "ST2" };
        l.Sort(NaturligOrdning.Instans);
        Assert.Equal(new[] { "R2", "R10", "r101", "R1001", "ST2" }, l);
    }

    [Fact]
    public void Iplistan_visar_gatewayens_ip()
    {
        var gw = K("GW1", "AS01", Gateways.Komponenttyp, "Modbus TCP", Moxa);
        gw.Id = Guid.NewGuid();
        var u = K("R1-GT501", "GW1-Port1", "Rumsregulator", "Modbus RTU");
        var alla = new List<Komponent> { gw, u };
        var def = Projekteringsverktyg.Server.ListApi.Listdefinitioner.Hitta("iplista")!;
        var data = new Dictionary<string, string> { ["enhet"] = gw.Id.ToString(), ["ip"] = "1.2.3.4" };
        Projekteringsverktyg.Server.ListApi.KolumnDef.BeraknaAlla(def.Kolumner, data, alla);
        Assert.Equal("10.0.0.5", data["ip"]);
        var fri = new Dictionary<string, string> { ["enhet"] = "Router", ["ip"] = "1.2.3.4" };
        Projekteringsverktyg.Server.ListApi.KolumnDef.BeraknaAlla(def.Kolumner, fri, alla);
        Assert.Equal("1.2.3.4", fri["ip"]);
        Assert.Equal("10.0.0.5", Gateways.Harledd(u, "_gatewayip", alla));
    }

    [Fact]
    public void Kedjan_gar_via_rc_till_gatewayporten()
    {
        var gw = K("GW-MB-RTU1", "AS01", Gateways.Komponenttyp, "Modbus TCP", Moxa);
        var rc = K("A1203-RC01", "GW-MB-RTU1-Port2", "Rumsregulator", "Modbus RTU");
        var st = K("A1203-RC01-ST41:1", "A1203-RC01", "Spjällställdon", "Modbus RTU");
        var gn = K("A1203-RC01-GN51", "a1203-rc01", "Närvarogivare", "DI");
        var alla = new List<Komponent> { gw, rc, st, gn };

        Assert.Equal("GW-MB-RTU1-Port2", Gateways.Harledd(rc, "_gateway", alla));
        Assert.Equal("", Gateways.Harledd(rc, "_via", alla));
        Assert.Equal("GW-MB-RTU1-Port2", Gateways.Harledd(st, "_gateway", alla));
        Assert.Equal("A1203-RC01", Gateways.Harledd(st, "_via", alla));
        Assert.Equal("19200 8N2", Gateways.Harledd(gn, "_installning", alla));
        Assert.True(Gateways.ArModbusEnhet(st));
        Assert.False(Gateways.ArModbusEnhet(gw));
        Assert.False(Gateways.ArModbusEnhet(gn));
    }

    [Fact]
    public void Okand_anslutning_och_cirklar_ger_ingen_gateway()
    {
        var a = K("A", "B");
        var b = K("B", "A");
        var c = K("C", "AS01");
        var alla = new List<Komponent> { a, b, c };
        Assert.Null(Gateways.Kedja(a, alla));
        Assert.Null(Gateways.Kedja(c, alla));
    }

    [Fact]
    public void Inställningar_maste_vara_ett_objekt()
    {
        var k = new Komponent();
        Assert.Throws<ArgumentException>(() => KomponentFalt.Satt(k, "installningar", "[1,2]"));
        Assert.Throws<ArgumentException>(() => KomponentFalt.Satt(k, "installningar", "{inte json"));
        KomponentFalt.Satt(k, "installningar", Moxa);
        Assert.Equal(2, Gateways.Las(k).Portar.Count);
        Assert.Equal("9600 8E1", Gateways.Installning(Gateways.Las(k).Portar[0]));
    }
}


public class ProduktTester
{
    private const string Register = """{"produkter":[{"id":"1","fabrikat":"Siemens","modell":"QAE2120","komponenttyp":"Temperaturgivare","io":"AI","stromA":"","fas":"","utgatt":false},{"id":"2","fabrikat":"Grundfos","modell":"Magna3 40-120","komponenttyp":"Pump","io":"DI DU AU","stromA":"1,2","fas":"3"}]}""";

    [Fact]
    public void Produkt_fyller_i_tomma_falt_och_ger_strom()
    {
        var produkter = Produkter.Las(Register);
        Assert.Equal(2, produkter.Count);
        var p = Produkter.Hitta(produkter, " siemens qae2120 ")!;
        Assert.Equal("Siemens QAE2120", p.Namn);

        var k = new Komponent { Komponenttyp = "" };
        Assert.Equal(new[] { "komponenttyp", "I/O" }, Produkter.FyllFran(k, p));
        Assert.Equal("Temperaturgivare", k.Komponenttyp);
        Assert.Equal("AI", k.Signaltyp);

        // Ifyllda fält skrivs inte över.
        var k2 = new Komponent { Komponenttyp = "Rumsgivare" };
        KomponentFalt.Satt(k2, "signaltyp", "DI");
        Assert.Empty(Produkter.FyllFran(k2, p));
        Assert.Equal("Rumsgivare", k2.Komponenttyp);

        var pump = Produkter.Hitta(produkter, "Grundfos Magna3 40-120")!;
        Assert.Equal(new Dictionary<string, string> { ["l1"] = "1.2", ["l2"] = "1.2", ["l3"] = "1.2" }, Produkter.Strom(pump));
        Assert.Empty(Produkter.Strom(p));
        Assert.Empty(Produkter.Las("inte json"));
    }

    [Fact]
    public void Grundregistret_finns() =>
        Assert.True(Produkter.Las(Projekteringsverktyg.Server.DokumentApi.GemensamKatalogEndpoints.Grund(Produkter.Katalog)).Count >= 40);
}
