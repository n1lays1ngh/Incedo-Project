namespace Bank.Domain;

public enum Role { Customer, Officer, SupportAgent, Admin }

public enum ApplicationStatus
{
    Draft,
    Submitted,
    KycPending,
    KycVerified,
    UnderReview,
    Approved,
    Rejected,
    ActionRequired
}

public enum KycDocumentType { Pan, Aadhaar, AddressProof, SalarySlip }

public enum KycDocumentStatus { Uploaded, Verified, Rejected }

public enum TicketStatus { Open, Answered, Closed }

public enum EmploymentType { Salaried, SelfEmployed }

public enum SavingsVariant { Regular, Salary, Student }

public enum RejectionCategory { Eligibility, Documents, Affordability, Policy, Other }

public static class ProductCodes
{
    public const string Savings = "SAVINGS";
    public const string Loan = "LOAN";
}
