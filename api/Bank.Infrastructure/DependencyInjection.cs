using Amazon;
using Amazon.S3;
using Amazon.SimpleEmailV2;
using Bank.Application;
using Bank.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Bank.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services, IConfiguration configuration, bool isDevelopment, string contentRoot)
    {
        var connection = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.");
        services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connection));
        services.AddScoped<IAppDb>(sp => sp.GetRequiredService<AppDbContext>());

        services.AddSingleton<CryptoKeys>();
        services.AddSingleton<IPiiCipher, AesGcmPiiCipher>();
        services.AddSingleton<ITokenHasher, HmacTokenHasher>();
        services.AddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();

        var storageProvider = configuration["Storage:Provider"] ?? "s3";
        var emailProvider = configuration["Email:Provider"] ?? "ses";
        if (!isDevelopment && (storageProvider != "s3" || emailProvider != "ses"))
            throw new InvalidOperationException("Local storage and email providers are allowed only in Development.");

        if (storageProvider == "local")
        {
            services.AddSingleton(sp => new LocalDevStorage(configuration, sp.GetRequiredService<CryptoKeys>(), contentRoot));
            services.AddSingleton<IStorage>(sp => sp.GetRequiredService<LocalDevStorage>());
        }
        else
        {
            services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client(Region(configuration)));
            services.AddSingleton<IStorage, S3Storage>();
        }

        if (emailProvider == "outbox")
        {
            services.AddSingleton<IEmailSender>(_ => new LocalOutboxEmailSender(contentRoot));
        }
        else
        {
            services.AddSingleton<IAmazonSimpleEmailServiceV2>(_ => new AmazonSimpleEmailServiceV2Client(Region(configuration)));
            services.AddSingleton<IEmailSender, SesEmailSender>();
        }

        return services;
    }

    private static RegionEndpoint Region(IConfiguration configuration) =>
        RegionEndpoint.GetBySystemName(configuration["Aws:Region"] ?? throw new InvalidOperationException("Aws:Region is not configured."));
}

public static class DbSeeder
{
    /// <summary>Creates the first Admin and, when Seed:DemoPassword is set, synthetic demo users. Safe to run repeatedly.</summary>
    public static async Task SeedAsync(AppDbContext db, IPasswordHasher passwords, IPiiCipher cipher, IConfiguration configuration, CancellationToken ct)
    {
        var adminEmail = configuration["Seed:AdminEmail"];
        var adminPassword = configuration["Seed:AdminPassword"];
        if (!string.IsNullOrWhiteSpace(adminEmail) && !string.IsNullOrWhiteSpace(adminPassword))
            await EnsureUserAsync(db, passwords, adminEmail, adminPassword, Role.Admin, ct);

        var demoPassword = configuration["Seed:DemoPassword"];
        if (!string.IsNullOrWhiteSpace(demoPassword))
        {
            await EnsureUserAsync(db, passwords, "officer@demo.test", demoPassword, Role.Officer, ct);
            await EnsureUserAsync(db, passwords, "agent@demo.test", demoPassword, Role.SupportAgent, ct);
            var customer = await EnsureUserAsync(db, passwords, "customer@demo.test", demoPassword, Role.Customer, ct);
            if (!await db.CustomerProfiles.AnyAsync(p => p.UserId == customer.Id, ct))
            {
                db.CustomerProfiles.Add(new CustomerProfile
                {
                    UserId = customer.Id,
                    Name = "Demo Customer",
                    Dob = new DateOnly(1994, 4, 12),
                    Address = "12 Sample Street, Testville",
                    Occupation = "Engineer",
                    MonthlyIncome = 85000m,
                    PanEncrypted = cipher.Encrypt("AAAAA0000A"),
                    AadhaarEncrypted = cipher.Encrypt("000000000000")
                });
            }
        }

        await db.SaveChangesAsync(ct);
    }

    private static async Task<User> EnsureUserAsync(AppDbContext db, IPasswordHasher passwords, string email, string password, Role role, CancellationToken ct)
    {
        var normalized = AuthService.NormalizeEmail(email);
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == normalized, ct);
        if (user is not null) return user;

        user = new User { Email = normalized, PasswordHash = passwords.Hash(password), Role = role, EmailVerified = true };
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
        return user;
    }
}
