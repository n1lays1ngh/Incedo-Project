using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Bank.Application;
using Microsoft.Extensions.Configuration;

namespace Bank.Infrastructure;

/// <summary>Development-only stand-in for S3. Uses short-lived signed links, like presigned URLs.</summary>
public sealed class LocalDevStorage(IConfiguration configuration, CryptoKeys keys, string contentRoot) : IStorage
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromMinutes(5);
    private string Root => Path.Combine(contentRoot, ".dev", "storage");
    private string BaseUrl => (configuration["Storage:LocalBaseUrl"] ?? "http://localhost:5080").TrimEnd('/');

    public Task<PresignedUpload> CreateUploadUrlAsync(string key, string contentType, long sizeBytes, CancellationToken ct)
    {
        var expires = DateTime.UtcNow + LinkLifetime;
        var exp = new DateTimeOffset(expires).ToUnixTimeSeconds();
        var sig = Sign("PUT", key, exp, contentType, sizeBytes);
        var url = $"{BaseUrl}/dev-storage/{key}?exp={exp}&size={sizeBytes}&sig={sig}";
        IReadOnlyDictionary<string, string> headers = new Dictionary<string, string> { ["Content-Type"] = contentType };
        return Task.FromResult(new PresignedUpload(url, headers, expires));
    }

    public Task<StoredObject?> HeadAsync(string key, CancellationToken ct)
    {
        var file = PathFor(key);
        var meta = file + ".type";
        if (!File.Exists(file) || !File.Exists(meta)) return Task.FromResult<StoredObject?>(null);
        return Task.FromResult<StoredObject?>(new StoredObject(File.ReadAllText(meta), new FileInfo(file).Length));
    }

    public Task<string> CreateViewUrlAsync(string key, CancellationToken ct)
    {
        var exp = DateTimeOffset.UtcNow.Add(LinkLifetime).ToUnixTimeSeconds();
        return Task.FromResult($"{BaseUrl}/dev-storage/{key}?exp={exp}&sig={Sign("GET", key, exp, "", 0)}");
    }

    public bool IsValidUpload(string key, long exp, string contentType, long size, string sig) =>
        IsFresh(exp) && SignatureMatches(Sign("PUT", key, exp, contentType, size), sig);

    public bool IsValidView(string key, long exp, string sig) =>
        IsFresh(exp) && SignatureMatches(Sign("GET", key, exp, "", 0), sig);

    public async Task SaveAsync(string key, Stream content, string contentType, long size, CancellationToken ct)
    {
        var file = PathFor(key);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        await using (var output = File.Create(file))
        {
            await content.CopyToAsync(output, ct);
        }
        if (new FileInfo(file).Length != size)
        {
            File.Delete(file);
            throw Errors.BadRequest("Uploaded size does not match the signed size.");
        }
        await File.WriteAllTextAsync(file + ".type", contentType, ct);
    }

    public (string Path, string ContentType)? Open(string key)
    {
        var file = PathFor(key);
        var meta = file + ".type";
        return File.Exists(file) && File.Exists(meta) ? (file, File.ReadAllText(meta)) : null;
    }

    private string PathFor(string key)
    {
        var root = Path.GetFullPath(Root) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(root, key));
        return full.StartsWith(root, StringComparison.Ordinal) ? full : throw Errors.BadRequest("Invalid key.");
    }

    private static bool IsFresh(long exp) => DateTimeOffset.UtcNow.ToUnixTimeSeconds() <= exp;

    private static bool SignatureMatches(string expected, string actual) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(actual));

    private string Sign(string verb, string key, long exp, string contentType, long size)
    {
        var payload = string.Join('\n', verb, key, exp.ToString(CultureInfo.InvariantCulture), contentType, size.ToString(CultureInfo.InvariantCulture));
        return Convert.ToHexString(HMACSHA256.HashData(keys.TokenKey, Encoding.UTF8.GetBytes(payload)));
    }
}

/// <summary>Development-only stand-in for SES. Appends each email to a git-ignored file.</summary>
public sealed class LocalOutboxEmailSender(string contentRoot) : IEmailSender
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public async Task SendAsync(string to, string subject, string body, CancellationToken ct)
    {
        var directory = Path.Combine(contentRoot, ".dev");
        Directory.CreateDirectory(directory);
        var entry = $"--- {DateTime.UtcNow:O}\nTo: {to}\nSubject: {subject}\n\n{body}\n\n";
        await Gate.WaitAsync(ct);
        try
        {
            await File.AppendAllTextAsync(Path.Combine(directory, "outbox.log"), entry, ct);
        }
        finally
        {
            Gate.Release();
        }
    }
}
