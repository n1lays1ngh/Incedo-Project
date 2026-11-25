namespace Bank.Domain;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Email { get; set; }
    public required string PasswordHash { get; set; }
    public string? Phone { get; set; }
    public Role Role { get; set; } = Role.Customer;
    public bool EmailVerified { get; set; }
}

public class EmailOtp
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string CodeHash { get; set; }
    public DateTime ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public DateTime? ConsumedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class RefreshToken
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string TokenHash { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public Guid? ReplacedByTokenId { get; set; }
}

public class LoginAttempt
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Email { get; set; }
    public required string IpAddress { get; set; }
    public bool Succeeded { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class CustomerProfile
{
    public Guid UserId { get; set; }
    public required string Name { get; set; }
    public DateOnly Dob { get; set; }
    public required string Address { get; set; }
    public required string Occupation { get; set; }
    public decimal MonthlyIncome { get; set; }
    public string? PanEncrypted { get; set; }
    public string? AadhaarEncrypted { get; set; }
}

public class Product
{
    public int Id { get; set; }
    public required string Code { get; set; }
    public required string Name { get; set; }
    public decimal? AnnualInterestRate { get; set; }
}

/// <summary>Stored in the Applications table. Status changes only through <see cref="ApplyTransition"/>.</summary>
public class BankApplication
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public int ProductId { get; set; }
    public Product? Product { get; set; }
    public ApplicationStatus Status { get; private set; } = ApplicationStatus.Draft;
    public Guid? AssignedOfficerId { get; set; }
    public RejectionCategory? RejectionCategory { get; set; }
    public string? RejectionReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public uint Version { get; set; }
    public SavingsDetails? Savings { get; set; }
    public LoanDetails? Loan { get; set; }

    /// <summary>Called by StatusService, which also writes history, audit and notification.</summary>
    public void ApplyTransition(ApplicationStatus to, string? reason)
    {
        ApplicationStateMachine.EnsureAllowed(Status, to, reason);
        Status = to;
    }
}

public class SavingsDetails
{
    public Guid ApplicationId { get; set; }
    public SavingsVariant AccountVariant { get; set; }
    public required string NomineeName { get; set; }
    public required string NomineeRelation { get; set; }
    public DateTime? ConsentAt { get; set; }
}

public class LoanDetails
{
    public Guid ApplicationId { get; set; }
    public decimal Amount { get; set; }
    public int TenureMonths { get; set; }
    public required string Purpose { get; set; }
    public EmploymentType EmploymentType { get; set; }
    public decimal? AnnualInterestRate { get; set; }
    public decimal? Emi { get; set; }
    public decimal? EmiToIncomeRatio { get; set; }
}

public class KycDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    /// <summary>Set only for a salary slip, which belongs to one loan application.</summary>
    public Guid? ApplicationId { get; set; }
    public KycDocumentType Type { get; set; }
    public required string S3Key { get; set; }
    public KycDocumentStatus Status { get; set; } = KycDocumentStatus.Uploaded;
    public string? RejectReason { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
}

public class ApplicationStatusHistory
{
    public long Id { get; set; }
    public Guid ApplicationId { get; set; }
    public ApplicationStatus FromStatus { get; set; }
    public ApplicationStatus ToStatus { get; set; }
    public Guid ChangedBy { get; set; }
    public string? Reason { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class AuditLog
{
    public long Id { get; set; }
    public Guid ActorId { get; set; }
    public required string Action { get; set; }
    public required string EntityType { get; set; }
    public required string EntityId { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}

public class Notification
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public required string Type { get; set; }
    public required string Message { get; set; }
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Ticket
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CustomerId { get; set; }
    public Guid? ApplicationId { get; set; }
    public required string Subject { get; set; }
    public TicketStatus Status { get; set; } = TicketStatus.Open;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<TicketMessage> Messages { get; set; } = [];
}

public class TicketMessage
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TicketId { get; set; }
    public Guid AuthorId { get; set; }
    public required string Body { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
