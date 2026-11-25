using System.ComponentModel.DataAnnotations;
using Bank.Domain;

namespace Bank.Application;

// Auth
public record RegisterRequest(
    [Required, EmailAddress, MaxLength(254)] string Email,
    [Required, MinLength(8), MaxLength(128)] string Password,
    [Required, RegularExpression(@"^\+?[0-9]{10,15}$")] string Phone);
public record VerifyOtpRequest([Required, EmailAddress] string Email, [Required, RegularExpression("^[0-9]{6}$")] string Code);
public record ResendOtpRequest([Required, EmailAddress] string Email);
public record LoginRequest([Required, EmailAddress] string Email, [Required, MaxLength(128)] string Password);
public record RefreshRequest([Required] string RefreshToken);
public record MessageResponse(string Message);
public record AuthResponse(string AccessToken, string RefreshToken, Guid UserId, string Email, string Role);

// Profile
public record ProfileRequest(
    [Required, MaxLength(120)] string Name,
    DateOnly Dob,
    [Required, MaxLength(400)] string Address,
    [Required, MaxLength(120)] string Occupation,
    [Range(0, 100000000)] decimal MonthlyIncome,
    string? Pan,
    string? Aadhaar);
public record ProfileResponse(
    string Name, DateOnly Dob, string Address, string Occupation, decimal MonthlyIncome, string? PanMasked, string? AadhaarMasked);

// Products and applications
public record ProductResponse(int Id, string Code, string Name, decimal? AnnualInterestRate);
public record SavingsInput(SavingsVariant AccountVariant, [Required, MaxLength(120)] string NomineeName, [Required, MaxLength(60)] string NomineeRelation, bool Consent);
public record LoanInput([Range(10000, 5000000)] decimal Amount, [Range(6, 360)] int TenureMonths, [Required, MaxLength(200)] string Purpose, EmploymentType EmploymentType);
public record CreateApplicationRequest([Required] string ProductCode, SavingsInput? Savings, LoanInput? Loan);
public record UpdateApplicationRequest(SavingsInput? Savings, LoanInput? Loan);
public record EmiPreviewRequest([Range(10000, 5000000)] decimal Amount, [Range(6, 360)] int TenureMonths);
public record EmiPreviewResponse(decimal Emi, decimal AnnualInterestRate, decimal? EmiToIncomeRatio, bool HighRatioWarning);
public record SavingsResponse(string AccountVariant, string NomineeName, string NomineeRelation, DateTime? ConsentAt);
public record LoanResponse(decimal Amount, int TenureMonths, string Purpose, string EmploymentType, decimal? AnnualInterestRate, decimal? Emi, decimal? EmiToIncomeRatio, bool HighRatioWarning);
public record ApplicationSummary(Guid Id, string ProductCode, string ProductName, string Status, DateTime CreatedAt);
public record HistoryResponse(string FromStatus, string ToStatus, string? Reason, DateTime At);
public record ApplicationDetail(
    Guid Id, string ProductCode, string ProductName, string Status, string? RejectionCategory, string? RejectionReason, DateTime CreatedAt,
    SavingsResponse? Savings, LoanResponse? Loan, IReadOnlyList<HistoryResponse> History, IReadOnlyList<KycDocumentResponse> Documents);

// KYC
public record UploadUrlRequest(KycDocumentType Type, [Required] string ContentType, [Range(1, 5242880)] long SizeBytes, Guid? ApplicationId);
public record UploadUrlResponse(string Url, string S3Key, IReadOnlyDictionary<string, string> Headers, DateTime ExpiresAt);
public record RegisterDocumentRequest(KycDocumentType Type, [Required, MaxLength(300)] string S3Key, Guid? ApplicationId);
public record KycDocumentResponse(Guid Id, string Type, string Status, string? RejectReason, Guid? ApplicationId, DateTime UploadedAt);

// Notifications
public record NotificationResponse(Guid Id, string Type, string Message, bool IsRead, DateTime CreatedAt);

// Tickets
public record CreateTicketRequest([Required, MaxLength(160)] string Subject, [Required, MaxLength(4000)] string Body, Guid? ApplicationId);
public record TicketMessageRequest([Required, MaxLength(4000)] string Body);
public record TicketSummary(Guid Id, string Subject, string Status, Guid? ApplicationId, DateTime CreatedAt);
public record TicketMessageResponse(Guid Id, bool FromStaff, string Body, DateTime At);
public record TicketDetail(Guid Id, string Subject, string Status, Guid? ApplicationId, DateTime CreatedAt, IReadOnlyList<TicketMessageResponse> Messages);
public record AgentCustomerContext(string? CustomerName, IReadOnlyList<ApplicationSummary> Applications, IReadOnlyList<KycStatusItem> Kyc);
public record KycStatusItem(string Type, string Status);
public record AgentTicketDetail(TicketDetail Ticket, AgentCustomerContext Customer);

// Officer
public record QueueItem(Guid Id, string ProductCode, string CustomerName, string Status, bool AssignedToMe, DateTime CreatedAt);
public record OfficerApplicationDetail(ApplicationDetail Application, Guid CustomerId, Guid? AssignedOfficerId, bool AssignedToMe, ProfileResponse? Profile);
public record RejectDocumentRequest([Required, MaxLength(500)] string Reason);
public enum OfficerDecision { Approve, Reject, RequestInfo }
public record DecisionRequest(OfficerDecision Decision, [MaxLength(1000)] string? Reason, RejectionCategory? RejectionCategory);
public record ViewUrlResponse(string Url);

// Admin
public record AuditResponse(long Id, Guid ActorId, string Action, string EntityType, string EntityId, DateTime At);
public record CreateStaffRequest([Required, EmailAddress, MaxLength(254)] string Email, [Required, MinLength(8), MaxLength(128)] string Password, Role Role);
public record StaffResponse(Guid Id, string Email, string Role);
