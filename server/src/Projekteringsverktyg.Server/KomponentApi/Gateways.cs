using System.Text.Json;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.KomponentApi;

/// <summary>En port (slinga) på en gateway. Tomma värden = inte angivet.</summary>
public sealed record GatewayPort(string Namn, string TcpPort, string Baudrate, string Paritet, string Databitar, string Stopbit);

/// <summary>Gatewayens inställningar (sparas som JSON i Komponent.Installningar).</summary>
public sealed record GatewayInstallningar(string Typ, string Ip, List<GatewayPort> Portar);

/// <summary>
/// Gateways och anslutningskedjan. En gateway är en komponent med komponenttyp "Gateway" (typen, t.ex. GW-MB-RTU,
/// står i inställningarna). Komponenter ansluts med fältet Ansluts till: till ett skåp, till en gatewayport
/// ("GW-MB-RTU1-Port1") eller till en annan komponent (t.ex. en RC), som i sin tur är ansluten vidare.
/// Samma regler finns i webben (web/src/lib/gateway.ts).
/// </summary>
public static class Gateways
{
    public const string Komponenttyp = "Gateway";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static bool ArGateway(Komponent k) =>
        string.Equals(k.Komponenttyp.Trim(), Komponenttyp, StringComparison.OrdinalIgnoreCase);

    public static GatewayInstallningar Las(Komponent k)
    {
        GatewayInstallningar? g = null;
        if (!string.IsNullOrWhiteSpace(k.Installningar))
        {
            try { g = JsonSerializer.Deserialize<GatewayInstallningar>(k.Installningar, Json); }
            catch (JsonException) { g = null; }
        }
        var portar = (g?.Portar ?? []).Where(p => p is not null).ToList();
        return new GatewayInstallningar(g?.Typ ?? "GW-MB-RTU", g?.Ip ?? "", portar.Count > 0 ? portar : [new GatewayPort("Port1", "", "", "", "", "")]);
    }

    /// <summary>"9600 8E1" (tom om baudrate saknas).</summary>
    public static string Installning(GatewayPort p)
    {
        if (string.IsNullOrWhiteSpace(p.Baudrate)) return "";
        var paritet = (p.Paritet ?? "").Trim().ToUpperInvariant() switch { "EVEN" => "E", "ODD" => "O", "NONE" => "N", "MARK" => "M", "SPACE" => "S", var x => x.Length > 0 ? x[..1] : "" };
        var data = string.IsNullOrWhiteSpace(p.Databitar) ? "8" : p.Databitar.Trim();
        var stop = string.IsNullOrWhiteSpace(p.Stopbit) ? "1" : p.Stopbit.Trim();
        return $"{p.Baudrate.Trim()} {data}{paritet}{stop}";
    }

    /// <summary>Gatewayporten som ett Ansluts till-värde pekar på ("GW-MB-RTU1-Port1", eller bara "GW-MB-RTU1" = första porten).</summary>
    public static (Komponent Gateway, GatewayPort Port)? HittaPort(string anslutsTill, IEnumerable<Komponent> komponenter)
    {
        var v = (anslutsTill ?? "").Trim();
        if (v == "") return null;
        foreach (var gw in komponenter.Where(ArGateway))
        {
            var b = gw.Beteckning.Trim();
            if (b == "") continue;
            var inst = Las(gw);
            if (string.Equals(v, b, StringComparison.OrdinalIgnoreCase)) return (gw, inst.Portar[0]);
            foreach (var p in inst.Portar)
                if (string.Equals(v, $"{b}-{p.Namn.Trim()}", StringComparison.OrdinalIgnoreCase)) return (gw, p);
        }
        return null;
    }

    /// <summary>
    /// Följer Ansluts till uppåt (komponent → RC → gatewayport). Returnerar gatewayporten och komponenten närmast
    /// gatewayen ("via"), eller null om kedjan inte når en gateway. Max 10 steg (skydd mot cirklar).
    /// </summary>
    public static (Komponent Gateway, GatewayPort Port, Komponent? Via)? Kedja(Komponent k, IReadOnlyList<Komponent> komponenter)
    {
        var perBeteckning = komponenter.Where(x => x.Beteckning.Trim() != "")
            .GroupBy(x => x.Beteckning.Trim(), StringComparer.OrdinalIgnoreCase).ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var aktuell = k;
        Komponent? via = null;
        for (var i = 0; i < 10; i++)
        {
            if (HittaPort(aktuell.AnslutsTill, komponenter) is { } traff) return (traff.Gateway, traff.Port, via);
            if (!perBeteckning.TryGetValue(aktuell.AnslutsTill.Trim(), out var nasta) || nasta.Id == aktuell.Id || ArGateway(nasta)) return null;
            via = nasta;
            aktuell = nasta;
        }
        return null;
    }

    /// <summary>Härledda värden till listor (kolumntyp fran med KomponentFalt som börjar med _).</summary>
    public static string Harledd(Komponent k, string falt, IReadOnlyList<Komponent> komponenter) => falt switch
    {
        "_gateway" => Kedja(k, komponenter) is { } x ? $"{x.Gateway.Beteckning.Trim()}-{x.Port.Namn.Trim()}" : "",
        "_installning" => Kedja(k, komponenter) is { } x ? Installning(x.Port) : "",
        "_via" => Kedja(k, komponenter) is { Via: { } v } ? v.Beteckning : "",
        "_protokoll" => Protokoll(k),
        _ => "",
    };

    /// <summary>RTU, TCP eller båda, ur komponentens I/O-punkter.</summary>
    public static string Protokoll(Komponent k)
    {
        var typer = Signaler.Las(k).Select(s => s.Typ).ToHashSet();
        return string.Join(", ", new[] { typer.Contains("Modbus RTU") ? "RTU" : "", typer.Contains("Modbus TCP") ? "TCP" : "" }.Where(x => x != ""));
    }

    /// <summary>Komponenter som hör hemma i Modbus-listan: har en Modbus-punkt och är inte själva en gateway.</summary>
    public static bool ArModbusEnhet(Komponent k) =>
        !ArGateway(k) && Signaler.Las(k).Any(s => s.Typ is "Modbus RTU" or "Modbus TCP");
}
