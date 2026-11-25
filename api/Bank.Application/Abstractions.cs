using Bank.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Bank.Application;

public interface IAppDb
{
    DbSet<User> Users { get; }
    DbSet<EmailOtp> EmailOtps { get; }
    DbSet<RefreshToken> RefreshTokens { get; }
    DbSet<LoginAttempt> LoginAttempts { get; }
    DbSet<CustomerProfile> CustomerProfiles { get; }
    DbSet<Product> Products { get; }
    DbSet<BankApplication> Applications { get; }
    DbSet<SavingsDetails> SavingsDetails { get; }
    DbSet<LoanDetails> LoanDetails { get; }
    DbSet<KycDocument> KycDocuments { get; }
    DbSet<ApplicationStatusHistory> ApplicationStatusHistory { get; }
    DbSet<AuditLog> AuditLogs { get; }
    DbSet<Notification> Notifications { get; }
    DbSet<Ticket> Tickets { get; }
    DbSet<TicketMessage> TicketMessages { get; }

    Task<int> SaveChangesAsync(CancellationToken ct = default);
    Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken ct);

    /// <summary>Row-locks the customer until the transaction ends, so KYC completion and submit cannot race.</summary>
    Task LockCustomerAsync(Guid customerId, CancellationToken ct);
}

public record PresignedUpload(string Url, IReadOnlyDictionary<string, string> Headers, DateTime ExpiresAt);

public record StoredObject(string ContentType, long SizeBytes);

public interface IStorage
{
    Task<PresignedUpload> CreateUploadUrlAsync(string key, string contentType, long sizeBytes, CancellationToken ct);
    Task<StoredObject?> HeadAsync(string key, CancellationToken ct);
    Task<string> CreateViewUrlAsync(string key, CancellationToken ct);
}

public interface IEmailSender
{
    Task SendAsync(string to, string subject, string body, CancellationToken ct);
}

public interface IPiiCipher
{
    string Encrypt(string plaintext);
    string Decrypt(string ciphertext);
}

public interface IPasswordHasher
{
    string Hash(string password);
    bool Verify(string password, string hash);
}

public interface ITokenHasher
{
    string Hash(string value);
    bool Matches(string value, string hash);
}

public interface IJwtIssuer
{
    string Issue(User user);
}

public class AppException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public static class Errors
{
    public static AppException BadRequest(string message) => new(400, message);
    public static AppException Unauthorized(string message = "Invalid credentials.") => new(401, message);
    public static AppException Forbidden(string message = "You are not allowed to do this.") => new(403, message);
    public static AppException NotFound(string message = "Not found.") => new(404, message);
    public static AppException Conflict(string message) => new(409, message);
    public static AppException TooManyRequests(string message) => new(429, message);
}
