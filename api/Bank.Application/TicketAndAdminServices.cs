using Bank.Domain;
using Microsoft.EntityFrameworkCore;

namespace Bank.Application;

public sealed class TicketService(IAppDb db)
{
    public async Task<TicketDetail> CreateAsync(Guid customerId, CreateTicketRequest request, CancellationToken ct)
    {
        if (request.ApplicationId is { } applicationId
            && !await db.Applications.AnyAsync(a => a.Id == applicationId && a.CustomerId == customerId, ct))
            throw Errors.NotFound("Application not found.");

        var ticket = new Ticket { CustomerId = customerId, ApplicationId = request.ApplicationId, Subject = request.Subject.Trim() };
        ticket.Messages.Add(new TicketMessage { TicketId = ticket.Id, AuthorId = customerId, Body = request.Body.Trim() });
        db.Tickets.Add(ticket);
        await db.SaveChangesAsync(ct);
        return ToDetail(ticket);
    }

    public async Task<IReadOnlyList<TicketSummary>> ListAsync(Guid customerId, CancellationToken ct) =>
        await db.Tickets.AsNoTracking()
            .Where(t => t.CustomerId == customerId)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new TicketSummary(t.Id, t.Subject, t.Status.ToString(), t.ApplicationId, t.CreatedAt))
            .ToListAsync(ct);

    public async Task<TicketDetail> GetAsync(Guid customerId, Guid id, CancellationToken ct)
    {
        var ticket = await db.Tickets.AsNoTracking().Include(t => t.Messages)
            .FirstOrDefaultAsync(t => t.Id == id && t.CustomerId == customerId, ct)
            ?? throw Errors.NotFound("Ticket not found.");
        return ToDetail(ticket);
    }

    public async Task<TicketDetail> AddMessageAsync(Guid customerId, Guid id, string body, CancellationToken ct)
    {
        var ticket = await db.Tickets.Include(t => t.Messages)
            .FirstOrDefaultAsync(t => t.Id == id && t.CustomerId == customerId, ct)
            ?? throw Errors.NotFound("Ticket not found.");
        if (ticket.Status == TicketStatus.Closed) throw Errors.Conflict("This ticket is closed.");

        var message = new TicketMessage { TicketId = ticket.Id, AuthorId = customerId, Body = body.Trim() };
        db.TicketMessages.Add(message);
        ticket.Status = TicketStatus.Open;
        await db.SaveChangesAsync(ct);
        return ToDetail(ticket);
    }

    public static TicketDetail ToDetail(Ticket t) => new(
        t.Id, t.Subject, t.Status.ToString(), t.ApplicationId, t.CreatedAt,
        t.Messages.OrderBy(m => m.At)
            .Select(m => new TicketMessageResponse(m.Id, m.AuthorId != t.CustomerId, m.Body, m.At))
            .ToList());
}

public sealed class AgentService(IAppDb db, EmailQueue emails)
{
    public async Task<IReadOnlyList<TicketSummary>> ListAsync(CancellationToken ct) =>
        await db.Tickets.AsNoTracking()
            .OrderBy(t => t.Status).ThenByDescending(t => t.CreatedAt)
            .Select(t => new TicketSummary(t.Id, t.Subject, t.Status.ToString(), t.ApplicationId, t.CreatedAt))
            .ToListAsync(ct);

    public async Task<AgentTicketDetail> GetAsync(Guid id, CancellationToken ct)
    {
        var ticket = await db.Tickets.AsNoTracking().Include(t => t.Messages)
            .FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw Errors.NotFound("Ticket not found.");

        var name = await db.CustomerProfiles.AsNoTracking()
            .Where(p => p.UserId == ticket.CustomerId).Select(p => p.Name).FirstOrDefaultAsync(ct);
        var applications = await db.Applications.AsNoTracking().Include(a => a.Product)
            .Where(a => a.CustomerId == ticket.CustomerId)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);
        var kyc = await db.KycDocuments.AsNoTracking()
            .Where(d => d.CustomerId == ticket.CustomerId && d.ApplicationId == null)
            .OrderBy(d => d.Type)
            .ToListAsync(ct);

        return new AgentTicketDetail(TicketService.ToDetail(ticket), new AgentCustomerContext(
            name,
            applications.Select(ApplicationService.ToSummary).ToList(),
            kyc.Select(d => new KycStatusItem(d.Type.ToString(), d.Status.ToString())).ToList()));
    }

    public async Task<AgentTicketDetail> ReplyAsync(Guid agentId, Guid id, string body, CancellationToken ct)
    {
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw Errors.NotFound("Ticket not found.");
        if (ticket.Status == TicketStatus.Closed) throw Errors.Conflict("This ticket is closed.");

        var text = body.Trim();
        db.TicketMessages.Add(new TicketMessage { TicketId = id, AuthorId = agentId, Body = text });
        ticket.Status = TicketStatus.Answered;
        db.AuditLogs.Add(new AuditLog { ActorId = agentId, Action = "TicketReplied", EntityType = "Ticket", EntityId = id.ToString() });
        var message = $"Support replied to your ticket: {ticket.Subject}";
        db.Notifications.Add(new Notification { UserId = ticket.CustomerId, Type = "TicketReply", Message = message });
        var customer = await db.Users.FirstAsync(u => u.Id == ticket.CustomerId, ct);
        emails.Enqueue(customer.Email, "Support replied to your ticket", $"{message}\n\n{text}");

        await db.SaveChangesAsync(ct);
        await emails.FlushAsync(ct);
        return await GetAsync(id, ct);
    }

    public async Task<AgentTicketDetail> CloseAsync(Guid agentId, Guid id, CancellationToken ct)
    {
        var ticket = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id, ct) ?? throw Errors.NotFound("Ticket not found.");
        if (ticket.Status == TicketStatus.Closed) throw Errors.Conflict("This ticket is already closed.");

        ticket.Status = TicketStatus.Closed;
        db.AuditLogs.Add(new AuditLog { ActorId = agentId, Action = "TicketClosed", EntityType = "Ticket", EntityId = id.ToString() });
        db.Notifications.Add(new Notification { UserId = ticket.CustomerId, Type = "TicketClosed", Message = $"Your ticket was closed: {ticket.Subject}" });
        await db.SaveChangesAsync(ct);
        return await GetAsync(id, ct);
    }
}

public sealed class AdminService(IAppDb db, IPasswordHasher passwords)
{
    public async Task<IReadOnlyList<AuditResponse>> AuditAsync(int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 200);
        return await db.AuditLogs.AsNoTracking()
            .OrderByDescending(a => a.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new AuditResponse(a.Id, a.ActorId, a.Action, a.EntityType, a.EntityId, a.At))
            .ToListAsync(ct);
    }

    public async Task<StaffResponse> CreateStaffAsync(Guid adminId, CreateStaffRequest request, CancellationToken ct)
    {
        if (request.Role == Role.Customer) throw Errors.BadRequest("Staff role must be Officer, SupportAgent or Admin.");
        AuthService.EnsureStrongPassword(request.Password);

        var email = AuthService.NormalizeEmail(request.Email);
        if (await db.Users.AnyAsync(u => u.Email == email, ct)) throw Errors.Conflict("This email is already in use.");

        var user = new User { Email = email, PasswordHash = passwords.Hash(request.Password), Role = request.Role, EmailVerified = true };
        db.Users.Add(user);
        db.AuditLogs.Add(new AuditLog { ActorId = adminId, Action = $"StaffCreated:{request.Role}", EntityType = "User", EntityId = user.Id.ToString() });
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            throw Errors.Conflict("This email is already in use.");
        }
        return new StaffResponse(user.Id, user.Email, user.Role.ToString());
    }
}
