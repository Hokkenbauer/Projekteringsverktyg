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

    /// <summary>Fritt textfält (Att göra → Anteckningar).</summary>
    public string Anteckningar { get; set; } = "";
    public DateTimeOffset? AnteckningarAndrad { get; set; }
    public string AnteckningarAndradAv { get; set; } = "";

    public List<Komponent> Komponenter { get; set; } = new();
}

/// <summary>En rad i projektets Att göra-lista.</summary>
public class AttGoraPost
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjektId { get; set; }
    public string Text { get; set; } = "";
    public bool Klar { get; set; }
    public int Ordning { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
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
    public string Produkttyp { get; set; } = "";
    public string Produkt { get; set; } = "";
    public string Monteringsanvisning { get; set; } = "";

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

public static class Roller
{
    public const string Admin = "Admin";
    public const string Projektledare = "Projektledare";
    public const string System = "System";
    public const string Tekniker = "Tekniker";
    public const string Lasare = "Lasare";

    public static readonly IReadOnlyList<string> Alla = [Admin, Projektledare, System, Tekniker, Lasare];

    /// <summary>Roller som ser alla projekt, inte bara dem de är medlemmar i.</summary>
    public static bool SerAllaProjekt(string roll) => roll is Admin or Projektledare or System;
}

public class AnvandarPost
{
    public string Id { get; set; } = "";
    public string Namn { get; set; } = "";
    public string Epost { get; set; } = "";
    public string Roll { get; set; } = Roller.Tekniker;
    public DateTimeOffset Skapad { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset SenastInloggad { get; set; } = DateTimeOffset.UtcNow;
}

public class ProjektMedlem
{
    public Guid ProjektId { get; set; }
    public string AnvandarId { get; set; } = "";
    public DateTimeOffset Tillagd { get; set; } = DateTimeOffset.UtcNow;
    public string TillagdAv { get; set; } = "";
}

public class StatusRubrik
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Namn { get; set; } = "";
    public int Ordning { get; set; }
}

public class StatusUppgift
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjektId { get; set; }
    public Guid RubrikId { get; set; }
    public string Text { get; set; } = "";
    public int Ordning { get; set; }
    public bool Klar { get; set; }
    public string Kommentar { get; set; } = "";
    public string UtfordAv { get; set; } = "";
    public DateTimeOffset? KlarDatum { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}

/// <summary>En rad i en lista från den gemensamma listmotorn (se ListApi/Listdefinitioner.cs).</summary>
public class ListRad
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjektId { get; set; }
    public string Lista { get; set; } = "";
    public Guid? KomponentId { get; set; }
    /// <summary>Listans egna fält som JSON-objekt med textvärden.</summary>
    public string Data { get; set; } = "{}";
    public int Ordning { get; set; }
    public int Version { get; set; } = 1;
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}

public class ProjektText
{
    public Guid ProjektId { get; set; }
    public string Nyckel { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTimeOffset? Andrad { get; set; }
    public string AndradAv { get; set; } = "";
}

public class ProjektFil
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjektId { get; set; }
    public string Mapp { get; set; } = "";
    public string Namn { get; set; } = "";
    public int Version { get; set; }
    public long Storlek { get; set; }
    public string Typ { get; set; } = "";
    public string BlobNamn { get; set; } = "";
    public DateTimeOffset Uppladdad { get; set; } = DateTimeOffset.UtcNow;
    public string UppladdadAv { get; set; } = "";
}

/// <summary>Placeringsritningen för ett projekt (byggnader, plan, rum, placeringar, kablar) som JSON.</summary>
public class Ritning
{
    public Guid ProjektId { get; set; }
    public string Data { get; set; } = "";
    public int Version { get; set; } = 1;
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}

/// <summary>Färdig uppsättning komponenter som kan läggas till i ett projekt. Rader = JSON-lista med komponentfält.</summary>
public class KomponentMall
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Namn { get; set; } = "";
    public string Rader { get; set; } = "[]";
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}

/// <summary>Mall med kontrollpunkter. Typ: projekt, projektering eller service.</summary>
public class KontrollMall
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Typ { get; set; } = "";
    public string Namn { get; set; } = "";
    public string Beskrivning { get; set; } = "";
    /// <summary>JSON-lista med kontrollpunkternas text.</summary>
    public string Punkter { get; set; } = "[]";
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}

/// <summary>En kontroll i ett projekt. Kontrollpunkterna ligger i listrad med Lista = "kontroll-{Id}".</summary>
public class Kontroll
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjektId { get; set; }
    public string Typ { get; set; } = "";
    public string Namn { get; set; } = "";
    public string Beskrivning { get; set; } = "";
    public string MallNamn { get; set; } = "";
    public int Ordning { get; set; }
    public DateTimeOffset Andrad { get; set; } = DateTimeOffset.UtcNow;
    public string AndradAv { get; set; } = "";
}
