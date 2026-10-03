using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Projekteringsverktyg.Server.FilApi;

/// <summary>Var själva filerna sparas. I Azure: Blob Storage. Lokalt: en mapp på disken.</summary>
public interface IFilLagring
{
    Task SparaAsync(string namn, Stream innehall, string typ, CancellationToken ct);
    Task<Stream?> OppnaAsync(string namn, CancellationToken ct);
    Task TaBortAsync(string namn, CancellationToken ct);
}

public sealed class BlobLagring : IFilLagring
{
    private readonly BlobContainerClient _container;

    public BlobLagring(string blobUrl)
    {
        var bas = blobUrl.EndsWith('/') ? blobUrl : blobUrl + "/";
        _container = new BlobContainerClient(new Uri(new Uri(bas), "projektfiler"), new DefaultAzureCredential());
    }

    public async Task SparaAsync(string namn, Stream innehall, string typ, CancellationToken ct) =>
        await _container.GetBlobClient(namn).UploadAsync(innehall,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = typ } }, ct);

    public async Task<Stream?> OppnaAsync(string namn, CancellationToken ct)
    {
        var blob = _container.GetBlobClient(namn);
        if (!await blob.ExistsAsync(ct)) return null;
        return await blob.OpenReadAsync(cancellationToken: ct);
    }

    public async Task TaBortAsync(string namn, CancellationToken ct) =>
        await _container.GetBlobClient(namn).DeleteIfExistsAsync(cancellationToken: ct);
}

public sealed class DiskLagring(string rot) : IFilLagring
{
    private string Sokvag(string namn)
    {
        var full = Path.GetFullPath(Path.Combine(rot, namn));
        if (!full.StartsWith(Path.GetFullPath(rot), StringComparison.Ordinal)) throw new InvalidOperationException("Ogiltigt filnamn.");
        return full;
    }

    public async Task SparaAsync(string namn, Stream innehall, string typ, CancellationToken ct)
    {
        var s = Sokvag(namn);
        Directory.CreateDirectory(Path.GetDirectoryName(s)!);
        await using var fil = File.Create(s);
        await innehall.CopyToAsync(fil, ct);
    }

    public Task<Stream?> OppnaAsync(string namn, CancellationToken ct)
    {
        var s = Sokvag(namn);
        return Task.FromResult<Stream?>(File.Exists(s) ? File.OpenRead(s) : null);
    }

    public Task TaBortAsync(string namn, CancellationToken ct)
    {
        var s = Sokvag(namn);
        if (File.Exists(s)) File.Delete(s);
        return Task.CompletedTask;
    }
}
