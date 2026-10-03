using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;
using Projekteringsverktyg.Server.AnvandarApi;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.StatusApi;
using Projekteringsverktyg.Server.Synk;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

// ---------------------------------------------------------------------------
// Inloggning
// Med AzureAd:ClientId satt: jobbkonton via Microsoft Entra ID.
// Utan: utvecklingsinloggning (bara tillåtet i utvecklingsmiljön).
// ---------------------------------------------------------------------------
var entraClientId = builder.Configuration["AzureAd:ClientId"];
var entraTenantId = builder.Configuration["AzureAd:TenantId"];
var entraPaslagen = !string.IsNullOrWhiteSpace(entraClientId);

if (entraPaslagen)
{
    builder.Services
        .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

    // Webbläsare kan inte skicka en Authorization-header när livesynken ansluter,
    // så token skickas då som ?access_token=... och plockas upp här.
    builder.Services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
    {
        options.Events ??= new JwtBearerEvents();
        var tidigare = options.Events.OnMessageReceived;
        options.Events.OnMessageReceived = async ctx =>
        {
            if (tidigare is not null) await tidigare(ctx);
            var token = ctx.Request.Query["access_token"].ToString();
            if (string.IsNullOrEmpty(ctx.Token) && !string.IsNullOrEmpty(token)
                && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
            {
                ctx.Token = token;
            }
        };
    });
}
else
{
    if (!builder.Environment.IsDevelopment())
        throw new InvalidOperationException(
            "AzureAd:ClientId saknas. Inloggning via Entra ID måste vara konfigurerad utanför utvecklingsmiljön.");

    builder.Services
        .AddAuthentication(DevAuthHandler.Schema)
        .AddScheme<AuthenticationSchemeOptions, DevAuthHandler>(DevAuthHandler.Schema, null);
}

// Allt kräver inloggning om inget annat anges.
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

// ---------------------------------------------------------------------------
// Databas, livesynk
// ---------------------------------------------------------------------------
var anslutning = builder.Configuration.GetConnectionString("Projekt");
if (string.IsNullOrWhiteSpace(anslutning))
    throw new InvalidOperationException("ConnectionStrings:Projekt saknas.");

builder.Services.AddDbContext<PvDbContext>(o => o.UseNpgsql(anslutning));
builder.Services.AddSignalR();
builder.Services.AddSingleton<NarvaroRegister>();
builder.Services.AddScoped<Behorighet>();
builder.Services.AddProblemDetails();

var app = builder.Build();

// Uppdaterar databasens struktur (kör nya filer i Data/Migreringar).
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PvDbContext>();
    await Migrering.KorAsync(db, app.Logger);
}

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();
    app.UseHsts();
}

// HTTPS sköts av Azure App Service (httpsOnly). Ingen omdirigering här, så att
// Azures interna hälsokontroll över http inte stoppas.
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAuthentication();
app.UseAuthorization();

var version = Environment.GetEnvironmentVariable("APP_VERSION") ?? "lokal";

app.MapGet("/health", () => Results.Ok(new { status = "ok", version })).AllowAnonymous();

// Webbappen hämtar inloggningsinställningarna här, så att samma bygge fungerar i alla miljöer.
app.MapGet("/api/config", () => Results.Ok(new
{
    version,
    auth = entraPaslagen
        ? new { clientId = entraClientId, tenantId = entraTenantId, scope = $"api://{entraClientId}/access_as_user" }
        : null,
})).AllowAnonymous();

app.MapAnvandarEndpoints();
app.MapProjektEndpoints();
app.MapKomponentEndpoints();
app.MapAttGoraEndpoints();
app.MapRollEndpoints();
app.MapStatusEndpoints();
app.MapHub<ProjektHub>("/hubs/projekt");

// Alla andra adresser hör till webbappen (React sköter sin egen navigering).
app.MapFallbackToFile("index.html").AllowAnonymous();

app.Run();
