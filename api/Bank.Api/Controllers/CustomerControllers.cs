using Bank.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bank.Api.Controllers;

[ApiController, Route("auth"), AllowAnonymous]
public class AuthController(AuthService auth) : ControllerBase
{
    [HttpPost("register")]
    public Task<MessageResponse> Register(RegisterRequest request, CancellationToken ct) => auth.RegisterAsync(request, ct);

    [HttpPost("verify-otp")]
    public Task<MessageResponse> VerifyOtp(VerifyOtpRequest request, CancellationToken ct) => auth.VerifyOtpAsync(request, ct);

    [HttpPost("resend-otp")]
    public Task<MessageResponse> ResendOtp(ResendOtpRequest request, CancellationToken ct) => auth.ResendOtpAsync(request, ct);

    [HttpPost("login")]
    public Task<AuthResponse> Login(LoginRequest request, CancellationToken ct) =>
        auth.LoginAsync(request, HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown", ct);

    [HttpPost("refresh")]
    public Task<AuthResponse> Refresh(RefreshRequest request, CancellationToken ct) => auth.RefreshAsync(request, ct);
}

[ApiController, Route("me/profile"), Authorize(Roles = "Customer")]
public class ProfileController(ProfileService profiles) : ControllerBase
{
    [HttpGet]
    public Task<ProfileResponse> Get(CancellationToken ct) => profiles.GetAsync(User.UserId(), ct);

    [HttpPut]
    public Task<ProfileResponse> Save(ProfileRequest request, CancellationToken ct) => profiles.SaveAsync(User.UserId(), request, ct);
}

[ApiController, Route("products"), Authorize]
public class ProductsController(ProductService products) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<ProductResponse>> List(CancellationToken ct) => products.ListAsync(ct);
}

[ApiController, Route("applications"), Authorize(Roles = "Customer")]
public class ApplicationsController(ApplicationService applications) : ControllerBase
{
    [HttpPost]
    public Task<ApplicationDetail> Create(CreateApplicationRequest request, CancellationToken ct) =>
        applications.CreateAsync(User.UserId(), request, ct);

    [HttpPut("{id:guid}")]
    public Task<ApplicationDetail> Update(Guid id, UpdateApplicationRequest request, CancellationToken ct) =>
        applications.UpdateAsync(User.UserId(), id, request, ct);

    [HttpPost("{id:guid}/submit")]
    public Task<ApplicationDetail> Submit(Guid id, CancellationToken ct) => applications.SubmitAsync(User.UserId(), id, ct);

    [HttpGet]
    public Task<IReadOnlyList<ApplicationSummary>> List(CancellationToken ct) => applications.ListAsync(User.UserId(), ct);

    [HttpGet("{id:guid}")]
    public Task<ApplicationDetail> Get(Guid id, CancellationToken ct) => applications.GetAsync(User.UserId(), id, ct);
}

[ApiController, Route("loans"), Authorize(Roles = "Customer")]
public class LoansController(LoanService loans) : ControllerBase
{
    [HttpPost("emi-preview")]
    public Task<EmiPreviewResponse> Preview(EmiPreviewRequest request, CancellationToken ct) =>
        loans.PreviewAsync(User.UserId(), request, ct);
}

[ApiController, Route("kyc"), Authorize(Roles = "Customer")]
public class KycController(KycService kyc) : ControllerBase
{
    [HttpPost("upload-url")]
    public Task<UploadUrlResponse> UploadUrl(UploadUrlRequest request, CancellationToken ct) =>
        kyc.CreateUploadUrlAsync(User.UserId(), request, ct);

    [HttpPost("documents")]
    public Task<KycDocumentResponse> Register(RegisterDocumentRequest request, CancellationToken ct) =>
        kyc.RegisterAsync(User.UserId(), request, ct);

    [HttpGet("documents")]
    public Task<IReadOnlyList<KycDocumentResponse>> List(CancellationToken ct) => kyc.ListAsync(User.UserId(), ct);
}

[ApiController, Route("notifications"), Authorize]
public class NotificationsController(NotificationService notifications) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<NotificationResponse>> List(CancellationToken ct) => notifications.ListAsync(User.UserId(), ct);

    [HttpPatch("{id:guid}/read")]
    public async Task<IActionResult> Read(Guid id, CancellationToken ct)
    {
        await notifications.MarkReadAsync(User.UserId(), id, ct);
        return NoContent();
    }
}

[ApiController, Route("tickets"), Authorize(Roles = "Customer")]
public class TicketsController(TicketService tickets) : ControllerBase
{
    [HttpPost]
    public Task<TicketDetail> Create(CreateTicketRequest request, CancellationToken ct) => tickets.CreateAsync(User.UserId(), request, ct);

    [HttpGet]
    public Task<IReadOnlyList<TicketSummary>> List(CancellationToken ct) => tickets.ListAsync(User.UserId(), ct);

    [HttpGet("{id:guid}")]
    public Task<TicketDetail> Get(Guid id, CancellationToken ct) => tickets.GetAsync(User.UserId(), id, ct);

    [HttpPost("{id:guid}/messages")]
    public Task<TicketDetail> AddMessage(Guid id, TicketMessageRequest request, CancellationToken ct) =>
        tickets.AddMessageAsync(User.UserId(), id, request.Body, ct);
}
