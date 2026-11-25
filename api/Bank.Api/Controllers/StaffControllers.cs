using Bank.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bank.Api.Controllers;

[ApiController, Route("officer"), Authorize(Roles = "Officer")]
public class OfficerController(OfficerService officer) : ControllerBase
{
    [HttpGet("queue")]
    public Task<IReadOnlyList<QueueItem>> Queue(CancellationToken ct) => officer.QueueAsync(User.UserId(), ct);

    [HttpPost("applications/{id:guid}/claim")]
    public async Task<IActionResult> Claim(Guid id, CancellationToken ct)
    {
        await officer.ClaimAsync(User.UserId(), id, ct);
        return NoContent();
    }

    [HttpGet("applications/{id:guid}")]
    public Task<OfficerApplicationDetail> Get(Guid id, CancellationToken ct) => officer.GetAsync(User.UserId(), id, ct);

    [HttpGet("applications/{id:guid}/history")]
    public Task<IReadOnlyList<HistoryResponse>> History(Guid id, CancellationToken ct) => officer.HistoryAsync(id, ct);

    [HttpPost("applications/{id:guid}/decision")]
    public async Task<IActionResult> Decide(Guid id, DecisionRequest request, CancellationToken ct)
    {
        await officer.DecideAsync(User.UserId(), id, request, ct);
        return NoContent();
    }

    [HttpPost("kyc/{docId:guid}/verify")]
    public Task<KycDocumentResponse> Verify(Guid docId, CancellationToken ct) => officer.VerifyDocumentAsync(User.UserId(), docId, ct);

    [HttpPost("kyc/{docId:guid}/reject")]
    public Task<KycDocumentResponse> Reject(Guid docId, RejectDocumentRequest request, CancellationToken ct) =>
        officer.RejectDocumentAsync(User.UserId(), docId, request.Reason, ct);

    [HttpGet("kyc/{docId:guid}/view-url")]
    public Task<ViewUrlResponse> ViewUrl(Guid docId, CancellationToken ct) => officer.ViewUrlAsync(User.UserId(), docId, ct);
}

[ApiController, Route("agent/tickets"), Authorize(Roles = "SupportAgent")]
public class AgentController(AgentService agent) : ControllerBase
{
    [HttpGet]
    public Task<IReadOnlyList<TicketSummary>> List(CancellationToken ct) => agent.ListAsync(ct);

    [HttpGet("{id:guid}")]
    public Task<AgentTicketDetail> Get(Guid id, CancellationToken ct) => agent.GetAsync(id, ct);

    [HttpPost("{id:guid}/reply")]
    public Task<AgentTicketDetail> Reply(Guid id, TicketMessageRequest request, CancellationToken ct) =>
        agent.ReplyAsync(User.UserId(), id, request.Body, ct);

    [HttpPost("{id:guid}/close")]
    public Task<AgentTicketDetail> Close(Guid id, CancellationToken ct) => agent.CloseAsync(User.UserId(), id, ct);
}

[ApiController, Route("admin"), Authorize(Roles = "Admin")]
public class AdminController(AdminService admin) : ControllerBase
{
    [HttpGet("audit")]
    public Task<IReadOnlyList<AuditResponse>> Audit([FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default) =>
        admin.AuditAsync(page, pageSize, ct);

    [HttpPost("staff")]
    public Task<StaffResponse> CreateStaff(CreateStaffRequest request, CancellationToken ct) =>
        admin.CreateStaffAsync(User.UserId(), request, ct);
}
