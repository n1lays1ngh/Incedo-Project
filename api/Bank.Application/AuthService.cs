using System.Security.Cryptography;
using Bank.Domain;
using Microsoft.EntityFrameworkCore;

namespace Bank.Application;

public sealed class AuthService(IAppDb db, IPasswordHasher passwords, ITokenHasher tokens, IJwtIssuer jwt, EmailQueue emails)
{
    private const int MaxLoginFailures = 5;
    private const int MaxOtpAttempts = 5;
    private static readonly TimeSpan LoginWindow = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan OtpResendGap = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(7);
    private const string GenericRegistered = "If this email can be registered, a verification code has been sent.";

    // Verified against when the email is unknown, so response time does not reveal which accounts exist.
    private readonly Lazy<string> _dummyHash = new(() => passwords.Hash(Convert.ToHexString(RandomNumberGenerator.GetBytes(16))));

    public static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    public async Task<MessageResponse> RegisterAsync(RegisterRequest request, CancellationToken ct)
    {
        EnsureStrongPassword(request.Password);
        var email = NormalizeEmail(request.Email);
        if (await db.Users.AnyAsync(u => u.Email == email, ct)) return new MessageResponse(GenericRegistered);

        var user = new User
        {
            Email = email,
            PasswordHash = passwords.Hash(request.Password),
            Phone = request.Phone,
            Role = Role.Customer
        };
        db.Users.Add(user);
        var code = StageOtp(user.Id);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return new MessageResponse(GenericRegistered);
        }

        emails.Enqueue(email, "Your verification code", $"Your verification code is {code}. It expires in 10 minutes.");
        await emails.FlushAsync(ct);
        return new MessageResponse(GenericRegistered);
    }

    public async Task<MessageResponse> VerifyOtpAsync(VerifyOtpRequest request, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        var invalid = Errors.BadRequest("Invalid or expired code.");
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct) ?? throw invalid;
        if (user.EmailVerified) throw invalid;

        var now = DateTime.UtcNow;
        var otp = await db.EmailOtps.AsNoTracking()
            .Where(o => o.UserId == user.Id)
            .OrderByDescending(o => o.CreatedAt)
            .FirstOrDefaultAsync(ct) ?? throw invalid;
        if (otp.ConsumedAt is not null || otp.ExpiresAt <= now) throw invalid;

        // Counting the attempt atomically stops parallel guesses from exceeding the limit.
        var counted = await db.EmailOtps
            .Where(o => o.Id == otp.Id && o.ConsumedAt == null && o.Attempts < MaxOtpAttempts)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.Attempts, o => o.Attempts + 1), ct);
        if (counted == 0 || !tokens.Matches(request.Code, otp.CodeHash)) throw invalid;

        var consumed = await db.EmailOtps
            .Where(o => o.Id == otp.Id && o.ConsumedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.ConsumedAt, now), ct);
        if (consumed == 0) throw invalid;

        user.EmailVerified = true;
        await db.SaveChangesAsync(ct);
        return new MessageResponse("Email verified. You can now sign in.");
    }

    public async Task<MessageResponse> ResendOtpAsync(ResendOtpRequest request, CancellationToken ct)
    {
        var response = new MessageResponse("If this account needs verification, a new code has been sent.");
        var email = NormalizeEmail(request.Email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        if (user is null || user.EmailVerified) return response;

        var cutoff = DateTime.UtcNow - OtpResendGap;
        if (await db.EmailOtps.AnyAsync(o => o.UserId == user.Id && o.CreatedAt > cutoff, ct)) return response;

        var code = StageOtp(user.Id);
        await db.SaveChangesAsync(ct);
        emails.Enqueue(email, "Your verification code", $"Your verification code is {code}. It expires in 10 minutes.");
        await emails.FlushAsync(ct);
        return response;
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, string ipAddress, CancellationToken ct)
    {
        var email = NormalizeEmail(request.Email);
        var since = DateTime.UtcNow - LoginWindow;
        var failures = await db.LoginAttempts.CountAsync(
            a => a.Email == email && a.IpAddress == ipAddress && !a.Succeeded && a.At > since, ct);
        if (failures >= MaxLoginFailures)
            throw Errors.TooManyRequests("Too many failed sign-in attempts. Try again in 15 minutes.");

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
        var valid = passwords.Verify(request.Password, user?.PasswordHash ?? _dummyHash.Value) && user is not null;

        db.LoginAttempts.Add(new LoginAttempt { Email = email, IpAddress = ipAddress, Succeeded = valid });
        if (!valid)
        {
            await db.SaveChangesAsync(ct);
            throw Errors.Unauthorized();
        }
        if (!user!.EmailVerified)
        {
            await db.SaveChangesAsync(ct);
            throw Errors.Forbidden("Verify your email before signing in.");
        }

        var (refresh, _) = StageRefreshToken(user.Id);
        await db.SaveChangesAsync(ct);
        return ToResponse(user, refresh);
    }

    public async Task<AuthResponse> RefreshAsync(RefreshRequest request, CancellationToken ct)
    {
        var hash = tokens.Hash(request.RefreshToken);
        var now = DateTime.UtcNow;
        var current = await db.RefreshTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash, ct)
            ?? throw Errors.Unauthorized("Session expired.");

        if (current.RevokedAt is not null)
        {
            // A rotated token came back, so it may be stolen. End every session for this user.
            await RevokeAllAsync(current.UserId, now, ct);
            throw Errors.Unauthorized("Session expired.");
        }
        if (current.ExpiresAt <= now) throw Errors.Unauthorized("Session expired.");

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == current.UserId, ct)
            ?? throw Errors.Unauthorized("Session expired.");

        await using var tx = await db.BeginTransactionAsync(ct);
        var (raw, replacement) = StageRefreshToken(user.Id);
        await db.SaveChangesAsync(ct);
        var rotated = await db.RefreshTokens
            .Where(t => t.Id == current.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.ReplacedByTokenId, replacement.Id), ct);
        if (rotated == 0)
        {
            await tx.RollbackAsync(ct);
            throw Errors.Unauthorized("Session expired.");
        }
        await tx.CommitAsync(ct);
        return ToResponse(user, raw);
    }

    private Task RevokeAllAsync(Guid userId, DateTime now, CancellationToken ct) =>
        db.RefreshTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now), ct);

    private string StageOtp(Guid userId)
    {
        var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
        db.EmailOtps.Add(new EmailOtp { UserId = userId, CodeHash = tokens.Hash(code), ExpiresAt = DateTime.UtcNow + OtpLifetime });
        return code;
    }

    private (string Raw, RefreshToken Entity) StageRefreshToken(Guid userId)
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var entity = new RefreshToken { UserId = userId, TokenHash = tokens.Hash(raw), ExpiresAt = DateTime.UtcNow + RefreshLifetime };
        db.RefreshTokens.Add(entity);
        return (raw, entity);
    }

    private AuthResponse ToResponse(User user, string refresh) =>
        new(jwt.Issue(user), refresh, user.Id, user.Email, user.Role.ToString());

    public static void EnsureStrongPassword(string password)
    {
        if (password.Length < 8 || !password.Any(char.IsLetter) || !password.Any(char.IsDigit))
            throw Errors.BadRequest("Password must be at least 8 characters and include a letter and a number.");
    }
}
