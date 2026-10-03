namespace Projekteringsverktyg.Server.Data;

/// <summary>Ett projekt. Äger allt annat: komponenter, listor, filer och ändringslogg.</summary>
public class Projekt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Namn { get; set; } = "";
    public string Nummer { get; set; } = "";
    public string Kund { get; set; } = "";
    public string Ansvarig { get; set; } = "";
    public DateTimeOffset Skapad { get; set; } = DateTimeOffset.UtcNow;
    public string SkapadAv { get; set; } = "";

    public List<Komponent> Komponenter { get; set; } = new();
}

/// <summary>
/// Navet i hela programmet. Ritning, Skyltlista, Installationslista, Signallista,
/// Egenkontroll m.fl. pekar på komponentens Id och kopierar aldrig dess fält.
/// </summary>
public class Komponent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjektId { get; set; }
    public Projekt? Projekt { get; set; }

    public string System { get; set; } = "";
    public string Beteckning { get; set; } = "";
    public string Komponenttyp { get; set; } = "";
    public string Signaltyp { get; set; } = "";
    public string Beskrivning { get; set; } = "";
    public string AnslutsTill { get; set; } = "";
    public string Kabeltyp { get; set; } = "";
    public string Placering { get; set; } = "";
    public string Ovrigt { get; set; } = "";

    /// <summary>Räknas upp vid varje ändring. Skyddar mot att två personer skriver över varandra.</summary>
    public int Version { get; set; } = 1;
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}

/// <summary>En rad i ändringsloggen: vem ändrade vad, när, före och efter.</summary>
public class AndringsloggPost
{
    public long Id { get; set; }
    public Guid ProjektId { get; set; }
    public DateTimeOffset Tidpunkt { get; set; } = DateTimeOffset.UtcNow;
    public string AnvandarId { get; set; } = "";
    public string AnvandarNamn { get; set; } = "";
    public string Entitet { get; set; } = "";
    public Guid? EntitetId { get; set; }
    public string Beskrivning { get; set; } = "";
    public string? Falt { get; set; }
    public string? Fore { get; set; }
    public string? Efter { get; set; }
}

/// <summary>Personliga inställningar som följer med användaren till alla datorer.</summary>
public class AnvandarInstallning
{
    public string AnvandarId { get; set; } = "";
    public string Tema { get; set; } = "natt";
}
