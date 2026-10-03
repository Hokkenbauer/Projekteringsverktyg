using System.Collections.Concurrent;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Projekteringsverktyg.Server.Auth;

namespace Projekteringsverktyg.Server.Synk;

/// <summary>
/// Livesynk. Webbläsaren ansluter hit och går med i ett projekt; därefter skickar servern
/// alla ändringar i projektet till alla som har det öppet.
/// Meddelanden till klienten: KomponentSkapad, KomponentAndrad, KomponentBorttagen, Narvaro.
/// </summary>
[Authorize]
public sealed class ProjektHub(NarvaroRegister narvaro) : Hub
{
    public static string Grupp(Guid projektId) => $"projekt:{projektId}";

    public async Task GaMedIProjekt(Guid projektId)
    {
        var anv = Anvandare.Fran(Context.User!);
        var tidigare = narvaro.Satt(Context.ConnectionId, projektId, anv);
        if (tidigare is { } gammalt && gammalt != projektId)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, Grupp(gammalt));
            await SkickaNarvaro(gammalt);
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, Grupp(projektId));
        await SkickaNarvaro(projektId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (narvaro.Ta(Context.ConnectionId) is { } projektId)
            await SkickaNarvaro(projektId);
        await base.OnDisconnectedAsync(exception);
    }

    private Task SkickaNarvaro(Guid projektId) =>
        Clients.Group(Grupp(projektId)).SendAsync("Narvaro", narvaro.I(projektId));
}

/// <summary>
/// Vilka som har vilket projekt öppet just nu. Ligger i minnet, vilket räcker så länge
/// appen körs på en server. Vid flera servrar flyttas detta till Azure SignalR Service.
/// </summary>
public sealed class NarvaroRegister
{
    private readonly ConcurrentDictionary<string, (Guid ProjektId, Anvandare Anvandare)> _anslutningar = new();

    /// <summary>Registrerar anslutningen och returnerar projektet den var i tidigare, om något.</summary>
    public Guid? Satt(string anslutning, Guid projektId, Anvandare anvandare)
    {
        Guid? tidigare = _anslutningar.TryGetValue(anslutning, out var t) ? t.ProjektId : null;
        _anslutningar[anslutning] = (projektId, anvandare);
        return tidigare;
    }

    public Guid? Ta(string anslutning) =>
        _anslutningar.TryRemove(anslutning, out var t) ? t.ProjektId : null;

    public IReadOnlyList<Anvandare> I(Guid projektId) =>
        _anslutningar.Values
            .Where(v => v.ProjektId == projektId)
            .Select(v => v.Anvandare)
            .DistinctBy(a => a.Id)
            .OrderBy(a => a.Namn)
            .ToList();
}
