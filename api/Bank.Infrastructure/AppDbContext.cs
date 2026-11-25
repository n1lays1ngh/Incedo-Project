using Bank.Application;
using Bank.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;

namespace Bank.Infrastructure;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options), IAppDb
{
    public DbSet<User> Users => Set<User>();
    public DbSet<EmailOtp> EmailOtps => Set<EmailOtp>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<LoginAttempt> LoginAttempts => Set<LoginAttempt>();
    public DbSet<CustomerProfile> CustomerProfiles => Set<CustomerProfile>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<BankApplication> Applications => Set<BankApplication>();
    public DbSet<SavingsDetails> SavingsDetails => Set<SavingsDetails>();
    public DbSet<LoanDetails> LoanDetails => Set<LoanDetails>();
    public DbSet<KycDocument> KycDocuments => Set<KycDocument>();
    public DbSet<ApplicationStatusHistory> ApplicationStatusHistory => Set<ApplicationStatusHistory>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketMessage> TicketMessages => Set<TicketMessage>();

    public Task<IDbContextTransaction> BeginTransactionAsync(CancellationToken ct) => Database.BeginTransactionAsync(ct);

    public async Task LockCustomerAsync(Guid customerId, CancellationToken ct)
    {
        await Database.ExecuteSqlInterpolatedAsync($@"SELECT 1 FROM ""Users"" WHERE ""Id"" = {customerId} FOR UPDATE", ct);
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder builder)
    {
        builder.Properties<Role>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<ApplicationStatus>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<KycDocumentType>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<KycDocumentStatus>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<EmploymentType>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<SavingsVariant>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<RejectionCategory>().HaveConversion<string>().HaveMaxLength(20);
        builder.Properties<TicketStatus>().HaveConversion<int>();
        builder.Properties<decimal>().HavePrecision(14, 4);
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>(e =>
        {
            e.HasIndex(x => x.Email).IsUnique();
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.Phone).HasMaxLength(20);
        });

        b.Entity<EmailOtp>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<RefreshToken>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.UserId);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<LoginAttempt>(e =>
        {
            e.HasIndex(x => new { x.Email, x.IpAddress, x.At });
            e.Property(x => x.Email).HasMaxLength(254);
            e.Property(x => x.IpAddress).HasMaxLength(45);
        });

        b.Entity<CustomerProfile>(e =>
        {
            e.HasKey(x => x.UserId);
            e.HasOne<User>().WithOne().HasForeignKey<CustomerProfile>(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Product>(e =>
        {
            e.HasIndex(x => x.Code).IsUnique();
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.AnnualInterestRate).HasPrecision(5, 2);
            e.HasData(
                new Product { Id = 1, Code = ProductCodes.Savings, Name = "Savings Account", AnnualInterestRate = null },
                new Product { Id = 2, Code = ProductCodes.Loan, Name = "Personal Loan", AnnualInterestRate = 10.50m });
        });

        b.Entity<BankApplication>(e =>
        {
            e.ToTable("Applications");
            e.HasIndex(x => x.CustomerId);
            e.HasIndex(x => new { x.Status, x.AssignedOfficerId });
            e.HasOne(x => x.Product).WithMany().HasForeignKey(x => x.ProductId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.AssignedOfficerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Savings).WithOne().HasForeignKey<SavingsDetails>(x => x.ApplicationId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Loan).WithOne().HasForeignKey<LoanDetails>(x => x.ApplicationId).OnDelete(DeleteBehavior.Cascade);
            e.Property(x => x.Status).HasField("<Status>k__BackingField").UsePropertyAccessMode(PropertyAccessMode.Field);

            // Postgres xmin rejects a stale write when two requests change the same application.
            if (Database.IsNpgsql()) e.Property(x => x.Version).IsRowVersion();
            else e.Ignore(x => x.Version);
        });

        b.Entity<SavingsDetails>().HasKey(x => x.ApplicationId);
        b.Entity<LoanDetails>(e =>
        {
            e.HasKey(x => x.ApplicationId);
            e.Property(x => x.Amount).HasPrecision(14, 2);
            e.Property(x => x.Emi).HasPrecision(14, 2);
            e.Property(x => x.AnnualInterestRate).HasPrecision(5, 2);
        });

        b.Entity<KycDocument>(e =>
        {
            e.HasOne<User>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<BankApplication>().WithMany().HasForeignKey(x => x.ApplicationId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => new { x.CustomerId, x.Type }).IsUnique()
                .HasDatabaseName("UX_Kyc_Customer_Type").HasFilter(@"""ApplicationId"" IS NULL");
            e.HasIndex(x => new { x.ApplicationId, x.Type }).IsUnique()
                .HasDatabaseName("UX_Kyc_Application_Type").HasFilter(@"""ApplicationId"" IS NOT NULL");
        });

        b.Entity<ApplicationStatusHistory>(e =>
        {
            e.ToTable("ApplicationStatusHistory");
            e.HasIndex(x => x.ApplicationId);
            e.HasOne<BankApplication>().WithMany().HasForeignKey(x => x.ApplicationId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<AuditLog>(e =>
        {
            e.ToTable("AuditLog");
            e.HasIndex(x => x.At);
        });

        b.Entity<Notification>(e =>
        {
            e.HasIndex(x => new { x.UserId, x.CreatedAt });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Ticket>(e =>
        {
            e.HasIndex(x => x.CustomerId);
            e.HasIndex(x => x.Status);
            e.HasOne<User>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<BankApplication>().WithMany().HasForeignKey(x => x.ApplicationId).OnDelete(DeleteBehavior.SetNull);
            e.HasMany(x => x.Messages).WithOne().HasForeignKey(x => x.TicketId).OnDelete(DeleteBehavior.Cascade);
        });

        // Ids are created in code, so EF must always insert a new entity rather than treat it as existing.
        foreach (var entity in b.Model.GetEntityTypes())
        {
            var id = entity.FindProperty("Id");
            if (id?.ClrType == typeof(Guid)) id.ValueGenerated = ValueGenerated.Never;
        }
    }
}

/// <summary>Lets `dotnet ef` build the model without starting the API. Pass the real database with --connection.</summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connection = Environment.GetEnvironmentVariable("ConnectionStrings__Migrate") ?? "Host=127.0.0.1;Database=design_time_only";
        return new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connection).Options);
    }
}
