using Bank.Domain;
using Microsoft.EntityFrameworkCore;

namespace Bank.Application;

public sealed class ProfileService(IAppDb db, IPiiCipher cipher)
{
    public async Task<ProfileResponse> GetAsync(Guid customerId, CancellationToken ct)
    {
        var profile = await db.CustomerProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == customerId, ct)
            ?? throw Errors.NotFound("Profile not created yet.");
        return ToResponse(profile, cipher);
    }

    public async Task<ProfileResponse> SaveAsync(Guid customerId, ProfileRequest request, CancellationToken ct)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (request.Dob > today.AddYears(-18)) throw Errors.BadRequest("You must be at least 18 years old.");

        var profile = await db.CustomerProfiles.FirstOrDefaultAsync(p => p.UserId == customerId, ct);
        if (profile is null)
        {
            profile = new CustomerProfile { UserId = customerId, Name = request.Name, Address = request.Address, Occupation = request.Occupation };
            db.CustomerProfiles.Add(profile);
        }

        profile.Name = request.Name.Trim();
        profile.Dob = request.Dob;
        profile.Address = request.Address.Trim();
        profile.Occupation = request.Occupation.Trim();
        profile.MonthlyIncome = request.MonthlyIncome;

        if (!string.IsNullOrWhiteSpace(request.Pan))
        {
            var pan = PiiMasking.NormalizePan(request.Pan);
            if (!PiiMasking.IsValidPan(pan)) throw Errors.BadRequest("PAN format is invalid.");
            profile.PanEncrypted = cipher.Encrypt(pan);
        }
        if (!string.IsNullOrWhiteSpace(request.Aadhaar))
        {
            var aadhaar = PiiMasking.NormalizeAadhaar(request.Aadhaar);
            if (!PiiMasking.IsValidAadhaar(aadhaar)) throw Errors.BadRequest("Aadhaar must be 12 digits.");
            profile.AadhaarEncrypted = cipher.Encrypt(aadhaar);
        }

        await db.SaveChangesAsync(ct);
        return ToResponse(profile, cipher);
    }

    public static ProfileResponse ToResponse(CustomerProfile p, IPiiCipher cipher) => new(
        p.Name, p.Dob, p.Address, p.Occupation, p.MonthlyIncome,
        p.PanEncrypted is null ? null : PiiMasking.MaskPan(cipher.Decrypt(p.PanEncrypted)),
        p.AadhaarEncrypted is null ? null : PiiMasking.MaskAadhaar(cipher.Decrypt(p.AadhaarEncrypted)));
}

public sealed class ProductService(IAppDb db)
{
    public async Task<IReadOnlyList<ProductResponse>> ListAsync(CancellationToken ct) =>
        await db.Products.AsNoTracking().OrderBy(p => p.Id)
            .Select(p => new ProductResponse(p.Id, p.Code, p.Name, p.AnnualInterestRate))
            .ToListAsync(ct);
}

public sealed class NotificationService(IAppDb db)
{
    public async Task<IReadOnlyList<NotificationResponse>> ListAsync(Guid userId, CancellationToken ct) =>
        await db.Notifications.AsNoTracking()
            .Where(n => n.UserId == userId)
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .Select(n => new NotificationResponse(n.Id, n.Type, n.Message, n.IsRead, n.CreatedAt))
            .ToListAsync(ct);

    public async Task MarkReadAsync(Guid userId, Guid id, CancellationToken ct)
    {
        var notification = await db.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, ct)
            ?? throw Errors.NotFound();
        notification.IsRead = true;
        await db.SaveChangesAsync(ct);
    }
}

public sealed class ApplicationService(IAppDb db, StatusService status, EmailQueue emails)
{
    public async Task<ApplicationDetail> CreateAsync(Guid customerId, CreateApplicationRequest request, CancellationToken ct)
    {
        var code = request.ProductCode.Trim().ToUpperInvariant();
        var product = await db.Products.FirstOrDefaultAsync(p => p.Code == code, ct)
            ?? throw Errors.BadRequest("Unknown product.");

        var app = new BankApplication { CustomerId = customerId, ProductId = product.Id, Product = product };
        ApplyDetails(app, code, request.Savings, request.Loan);
        db.Applications.Add(app);
        await db.SaveChangesAsync(ct);
        return await GetAsync(customerId, app.Id, ct);
    }

    public async Task<ApplicationDetail> UpdateAsync(Guid customerId, Guid id, UpdateApplicationRequest request, CancellationToken ct)
    {
        var app = await LoadOwnedAsync(customerId, id, ct);
        EnsureEditable(app);
        ApplyDetails(app, app.Product!.Code, request.Savings, request.Loan);
        await db.SaveChangesAsync(ct);
        return await GetAsync(customerId, id, ct);
    }

    public async Task<ApplicationDetail> SubmitAsync(Guid customerId, Guid id, CancellationToken ct)
    {
        await using var tx = await db.BeginTransactionAsync(ct);
        await db.LockCustomerAsync(customerId, ct);

        var app = await LoadOwnedAsync(customerId, id, ct);
        EnsureEditable(app);

        var profile = await db.CustomerProfiles.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == customerId, ct);
        if (profile is null || profile.PanEncrypted is null || profile.AadhaarEncrypted is null)
            throw Errors.BadRequest("Complete your profile, including PAN and Aadhaar, before submitting.");

        if (app.Product!.Code == ProductCodes.Loan)
        {
            var slip = await db.KycDocuments.AsNoTracking()
                .FirstOrDefaultAsync(d => d.ApplicationId == app.Id && d.Type == KycDocumentType.SalarySlip, ct);
            if (slip is null || slip.Status == KycDocumentStatus.Rejected)
                throw Errors.BadRequest("Upload a salary slip before submitting a loan application.");

            var rate = app.Product.AnnualInterestRate ?? throw Errors.Conflict("Loan rate is not configured.");
            var loan = app.Loan ?? throw Errors.BadRequest("Loan details are missing.");
            loan.AnnualInterestRate = rate;
            loan.Emi = EmiCalculator.Calculate(loan.Amount, rate, loan.TenureMonths);
            loan.EmiToIncomeRatio = EmiCalculator.IncomeRatio(loan.Emi.Value, profile.MonthlyIncome);
        }
        else if (app.Savings?.ConsentAt is null)
        {
            throw Errors.BadRequest("Consent is required for a savings account.");
        }

        var documents = await db.KycDocuments.AsNoTracking()
            .Where(d => d.CustomerId == customerId && d.ApplicationId == null)
            .ToListAsync(ct);

        await status.TransitionAsync(app, ApplicationStatus.Submitted, customerId, null, ct);
        var next = KycRules.IsCustomerVerified(documents) ? ApplicationStatus.UnderReview : ApplicationStatus.KycPending;
        await status.TransitionAsync(app, next, customerId, null, ct);

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        await emails.FlushAsync(ct);
        return await GetAsync(customerId, id, ct);
    }

    public async Task<IReadOnlyList<ApplicationSummary>> ListAsync(Guid customerId, CancellationToken ct)
    {
        var rows = await db.Applications.AsNoTracking()
            .Where(a => a.CustomerId == customerId)
            .Include(a => a.Product)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);
        return rows.Select(ToSummary).ToList();
    }

    public async Task<ApplicationDetail> GetAsync(Guid customerId, Guid id, CancellationToken ct)
    {
        var app = await db.Applications.AsNoTracking()
            .Include(a => a.Product).Include(a => a.Savings).Include(a => a.Loan)
            .FirstOrDefaultAsync(a => a.Id == id && a.CustomerId == customerId, ct)
            ?? throw Errors.NotFound("Application not found.");
        return await ToDetailAsync(db, app, ct);
    }

    public static ApplicationSummary ToSummary(BankApplication a) =>
        new(a.Id, a.Product!.Code, a.Product.Name, a.Status.ToString(), a.CreatedAt);

    public static async Task<ApplicationDetail> ToDetailAsync(IAppDb db, BankApplication a, CancellationToken ct)
    {
        var history = await db.ApplicationStatusHistory.AsNoTracking()
            .Where(h => h.ApplicationId == a.Id)
            .OrderBy(h => h.At).ThenBy(h => h.Id)
            .ToListAsync(ct);
        var documents = await db.KycDocuments.AsNoTracking()
            .Where(d => d.CustomerId == a.CustomerId && (d.ApplicationId == null || d.ApplicationId == a.Id))
            .OrderBy(d => d.Type)
            .ToListAsync(ct);

        return new ApplicationDetail(
            a.Id, a.Product!.Code, a.Product.Name, a.Status.ToString(), a.RejectionCategory?.ToString(), a.RejectionReason, a.CreatedAt,
            a.Savings is null ? null : new SavingsResponse(a.Savings.AccountVariant.ToString(), a.Savings.NomineeName, a.Savings.NomineeRelation, a.Savings.ConsentAt),
            a.Loan is null ? null : new LoanResponse(a.Loan.Amount, a.Loan.TenureMonths, a.Loan.Purpose, a.Loan.EmploymentType.ToString(),
                a.Loan.AnnualInterestRate, a.Loan.Emi, a.Loan.EmiToIncomeRatio, EmiCalculator.IsHighRatio(a.Loan.EmiToIncomeRatio)),
            history.Select(h => new HistoryResponse(h.FromStatus.ToString(), h.ToStatus.ToString(), h.Reason, h.At)).ToList(),
            documents.Select(KycService.ToResponse).ToList());
    }

    private async Task<BankApplication> LoadOwnedAsync(Guid customerId, Guid id, CancellationToken ct) =>
        await db.Applications.Include(a => a.Product).Include(a => a.Savings).Include(a => a.Loan)
            .FirstOrDefaultAsync(a => a.Id == id && a.CustomerId == customerId, ct)
        ?? throw Errors.NotFound("Application not found.");

    private static void EnsureEditable(BankApplication app)
    {
        if (app.Status is not (ApplicationStatus.Draft or ApplicationStatus.ActionRequired))
            throw Errors.Conflict("This application can no longer be changed.");
    }

    private static void ApplyDetails(BankApplication app, string code, SavingsInput? savings, LoanInput? loan)
    {
        if (code == ProductCodes.Savings)
        {
            if (savings is null) throw Errors.BadRequest("Savings details are required.");
            if (!savings.Consent) throw Errors.BadRequest("Consent is required for a savings account.");
            app.Savings ??= new SavingsDetails { ApplicationId = app.Id, NomineeName = savings.NomineeName, NomineeRelation = savings.NomineeRelation };
            app.Savings.AccountVariant = savings.AccountVariant;
            app.Savings.NomineeName = savings.NomineeName.Trim();
            app.Savings.NomineeRelation = savings.NomineeRelation.Trim();
            app.Savings.ConsentAt ??= DateTime.UtcNow;
            return;
        }

        if (loan is null) throw Errors.BadRequest("Loan details are required.");
        app.Loan ??= new LoanDetails { ApplicationId = app.Id, Purpose = loan.Purpose };
        app.Loan.Amount = loan.Amount;
        app.Loan.TenureMonths = loan.TenureMonths;
        app.Loan.Purpose = loan.Purpose.Trim();
        app.Loan.EmploymentType = loan.EmploymentType;
    }
}

public sealed class LoanService(IAppDb db)
{
    public async Task<EmiPreviewResponse> PreviewAsync(Guid customerId, EmiPreviewRequest request, CancellationToken ct)
    {
        var rate = await db.Products.AsNoTracking()
            .Where(p => p.Code == ProductCodes.Loan)
            .Select(p => p.AnnualInterestRate)
            .FirstOrDefaultAsync(ct) ?? throw Errors.Conflict("Loan rate is not configured.");
        var income = await db.CustomerProfiles.AsNoTracking()
            .Where(p => p.UserId == customerId)
            .Select(p => (decimal?)p.MonthlyIncome)
            .FirstOrDefaultAsync(ct);

        var emi = EmiCalculator.Calculate(request.Amount, rate, request.TenureMonths);
        var ratio = income is null ? null : EmiCalculator.IncomeRatio(emi, income.Value);
        return new EmiPreviewResponse(emi, rate, ratio, EmiCalculator.IsHighRatio(ratio));
    }
}
