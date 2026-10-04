using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
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
