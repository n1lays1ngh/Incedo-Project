using System.Security.Cryptography;
using System.Text;
using Bank.Application;
using Microsoft.Extensions.Configuration;

namespace Bank.Infrastructure;

public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const int Iterations = 210_000;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA512, HashBytes);
        return $"v1.{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    public bool Verify(string password, string stored)
    {
        var parts = stored.Split('.');
        if (parts.Length != 4 || parts[0] != "v1" || !int.TryParse(parts[1], out var iterations)) return false;
        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA512, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }
}

public sealed class CryptoKeys
{
    public byte[] PiiKey { get; }
    public byte[] TokenKey { get; }

    public CryptoKeys(IConfiguration configuration)
    {
        var configured = configuration["Crypto:PiiKey"] ?? throw new InvalidOperationException("Crypto:PiiKey is not configured.");
        var key = Convert.FromBase64String(configured);
        if (key.Length != 32) throw new InvalidOperationException("Crypto:PiiKey must be 32 bytes, base64 encoded.");
        PiiKey = key;
        TokenKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, key, 32, info: Encoding.UTF8.GetBytes("bank-portal/token-hash"));
    }
}

/// <summary>AES-256-GCM. Stored as base64 of nonce + tag + ciphertext.</summary>
public sealed class AesGcmPiiCipher(CryptoKeys keys) : IPiiCipher
{
    private const int NonceBytes = 12;
    private const int TagBytes = 16;

    public string Encrypt(string plaintext)
    {
        var data = Encoding.UTF8.GetBytes(plaintext);
        var output = new byte[NonceBytes + TagBytes + data.Length];
        var nonce = output.AsSpan(0, NonceBytes);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(keys.PiiKey, TagBytes);
        aes.Encrypt(nonce, data, output.AsSpan(NonceBytes + TagBytes), output.AsSpan(NonceBytes, TagBytes));
        return Convert.ToBase64String(output);
    }

    public string Decrypt(string ciphertext)
    {
        var input = Convert.FromBase64String(ciphertext);
        var data = new byte[input.Length - NonceBytes - TagBytes];
        using var aes = new AesGcm(keys.PiiKey, TagBytes);
        aes.Decrypt(input.AsSpan(0, NonceBytes), input.AsSpan(NonceBytes + TagBytes), input.AsSpan(NonceBytes, TagBytes), data);
        return Encoding.UTF8.GetString(data);
    }
}

/// <summary>Keyed hash for OTPs and refresh tokens. A 6-digit OTP cannot be brute-forced from a leaked table without the key.</summary>
public sealed class HmacTokenHasher(CryptoKeys keys) : ITokenHasher
{
    public string Hash(string value) =>
        Convert.ToHexString(HMACSHA256.HashData(keys.TokenKey, Encoding.UTF8.GetBytes(value)));

    public bool Matches(string value, string hash) =>
        CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(value)), Encoding.ASCII.GetBytes(hash));
}
