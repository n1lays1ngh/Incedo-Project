import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import type { AgentTicket, AuditEntry, KycDocument, OfficerApplication, QueueItem, TicketSummary } from '../api'
import { Alert, Amount, Badge, Empty, Field, Loading, PageHead, Panel, Ref, Timeline, dateOnly, dateTime, label, messageOf, percent, useLoad } from '../ui'

export function QueuePage() {
  const navigate = useNavigate()
  const state = useLoad(() => api.get<QueueItem[]>('/officer/queue'), [])
  const [error, setError] = useState('')
  const [claiming, setClaiming] = useState<string | null>(null)

  const claim = async (id: string) => {
    setError(''); setClaiming(id)
    try { await api.post(`/officer/applications/${id}/claim`) } catch (e) { setError(messageOf(e)) }
    setClaiming(null)
    await state.reload()
  }

  return (
    <>
      <PageHead eyebrow="Credit operations" title="Work queue" sub="Unclaimed applications, oldest first, and the ones assigned to you. Pick one up to review it." />
      <Alert>{error}</Alert>
      <Loading state={state} lines={6}>{(items) => {
        const mine = items.filter((q) => q.assignedToMe).length
        return (
          <section className="panel">
            <header className="panel-head"><h2>Applications</h2><span className="muted">{items.length} in queue · {mine} assigned to you</span></header>
            {items.length === 0 ? <Empty title="The queue is clear">New submissions will appear here.</Empty> : (
              <table>
                <thead><tr><th>Reference</th><th>Customer</th><th>Product</th><th>Status</th><th className="num">Received</th><th className="right">Action</th></tr></thead>
                <tbody>{items.map((q) => (
                  <tr key={q.id} className={q.assignedToMe ? 'clickable' : ''} onClick={q.assignedToMe ? () => navigate(`/officer/applications/${q.id}`) : undefined}>
                    <td><Ref id={q.id} /></td>
                    <td className="primary-text">{q.customerName}</td>
                    <td>{q.productCode === 'LOAN' ? 'Personal loan' : 'Savings account'}</td>
                    <td><Badge value={q.status} /></td>
                    <td className="num"><time>{dateTime(q.createdAt)}</time></td>
                    <td className="right">{q.assignedToMe
                      ? <Link className="button secondary small" to={`/officer/applications/${q.id}`} onClick={(e) => e.stopPropagation()}>Review</Link>
                      : <button className="small" disabled={claiming === q.id} onClick={() => void claim(q.id)}>{claiming === q.id ? 'Claiming…' : 'Pick up'}</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
        )
      }}</Loading>
    </>
  )
}

function DocumentRow({ doc, canReview, onChange }: { doc: KycDocument; canReview: boolean; onChange: () => void }) {
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState('')
  const isSlip = doc.type === 'SalarySlip'

  const run = async (action: () => Promise<unknown>) => {
    setError('')
    try { await action(); setRejecting(false); setReason(''); onChange() } catch (e) { setError(messageOf(e)) }
  }

  const view = async () => {
    setError('')
    const tab = window.open('', '_blank')
    try {
      const { url } = await api.get<{ url: string }>(`/officer/kyc/${doc.id}/view-url`)
      if (tab) { tab.opener = null; tab.location.href = url } else window.location.href = url
    } catch (e) {
      tab?.close()
      setError(messageOf(e))
    }
  }

  return (
    <div className="doc">
      <div className="row">
        <div>
          <span className="primary-text">{label(doc.type)}</span>
          <p className="muted">Uploaded {dateTime(doc.uploadedAt)}</p>
          {doc.rejectReason && <p className="error">Rejected: {doc.rejectReason}</p>}
        </div>
        <div className="row-end">
          <Badge value={doc.status} />
          <button className="small secondary" onClick={() => void view()} title="Opens a 5-minute link. This view is recorded in the audit log.">View</button>
          {canReview && doc.status === 'Uploaded' && <>
            <button className="small" onClick={() => void run(() => api.post(`/officer/kyc/${doc.id}/verify`))}>Verify</button>
            {!isSlip && <button className="small danger" onClick={() => setRejecting(!rejecting)}>Reject</button>}
          </>}
        </div>
      </div>
      {isSlip && canReview && doc.status === 'Uploaded' && <p className="muted small-text" style={{ marginTop: 6 }}>If this slip is unusable, use Request info in the decision panel.</p>}
      {rejecting && (
        <div className="inline">
          <input aria-label="Rejection reason" placeholder="Reason shown to the customer" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="small danger" disabled={!reason.trim()} onClick={() => void run(() => api.post(`/officer/kyc/${doc.id}/reject`, { reason }))}>Confirm rejection</button>
        </div>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  )
}

export function ReviewPage() {
  const { id } = useParams()
  const state = useLoad(() => api.get<OfficerApplication>(`/officer/applications/${id}`), [id])
  const [decision, setDecision] = useState('Approve')
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('Eligibility')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const decide = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await api.post(`/officer/applications/${id}/decision`, {
        decision,
        reason: decision === 'Approve' ? null : reason,
        rejectionCategory: decision === 'Reject' ? category : null,
      })
      setReason('')
      await state.reload()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Loading state={state} lines={10}>{(view) => {
      const a = view.application
      const canReview = view.assignedToMe && (a.status === 'KycPending' || a.status === 'UnderReview')
      return (
        <>
          <PageHead
            eyebrow={a.productCode === 'LOAN' ? 'Personal loan review' : 'Savings account review'}
            title={view.profile?.name ?? 'Customer'}
            sub={<>Reference <Ref id={a.id} /> · Received {dateTime(a.createdAt)}</>}
            action={<><Link className="button ghost small" to="/officer">← Queue</Link><Badge value={a.status} /></>}
          />
          {!view.assignedToMe && <Alert tone="warn">This application isn't assigned to you, so it's read-only.</Alert>}
          <div className="split">
            <div className="stack">
              {a.loan && (
                <Panel title="Eligibility" meta={a.loan.highRatioWarning ? 'Above 50% guideline' : 'Within guideline'}>
                  <dl className="facts">
                    <dt>Amount requested</dt><dd><Amount value={a.loan.amount} /></dd>
                    <dt>Tenure</dt><dd>{a.loan.tenureMonths} months</dd>
                    <dt>Interest rate</dt><dd>{a.loan.annualInterestRate == null ? '–' : `${a.loan.annualInterestRate.toFixed(2)}% p.a.`}</dd>
                    <dt>Monthly EMI</dt><dd><Amount value={a.loan.emi} /></dd>
                    <dt>Monthly income</dt><dd><Amount value={view.profile?.monthlyIncome} /></dd>
                    <dt>EMI to income</dt><dd style={a.loan.highRatioWarning ? { color: 'var(--warn)' } : undefined}>{percent(a.loan.emiToIncomeRatio)}</dd>
                    <dt>Purpose</dt><dd>{a.loan.purpose}</dd>
                    <dt>Employment</dt><dd>{label(a.loan.employmentType)}</dd>
                  </dl>
                  {a.loan.highRatioWarning && <div style={{ marginTop: 12 }}><Alert tone="warn">EMI is above 50% of monthly income. This is a warning, not a block.</Alert></div>}
                </Panel>
              )}
              {a.savings && (
                <Panel title="Account requested">
                  <dl className="facts"><dt>Account type</dt><dd>{a.savings.accountVariant}</dd><dt>Nominee</dt><dd>{a.savings.nomineeName} ({a.savings.nomineeRelation})</dd><dt>Consent given</dt><dd>{a.savings.consentAt ? dateTime(a.savings.consentAt) : '–'}</dd></dl>
                </Panel>
              )}
              <Panel title="Documents" meta="Every view is logged">
                {a.documents.length === 0 ? <Empty>No documents uploaded yet.</Empty> : a.documents.map((d) => <DocumentRow key={d.id} doc={d} canReview={canReview} onChange={() => void state.reload()} />)}
              </Panel>
            </div>
            <div className="stack">
              {view.assignedToMe && a.status === 'UnderReview' && (
                <form className="panel" onSubmit={decide}>
                  <header className="panel-head"><h2>Decision</h2></header>
                  <div className="panel-body form">
                    <Alert>{error}</Alert>
                    <Field label="Outcome">
                      <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                        <option value="Approve">Approve</option><option value="RequestInfo">Request information</option><option value="Reject">Reject</option>
                      </select>
                    </Field>
                    {decision === 'Reject' && (
                      <Field label="Category">
                        <select value={category} onChange={(e) => setCategory(e.target.value)}>
                          {['Eligibility', 'Documents', 'Affordability', 'Policy', 'Other'].map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </Field>
                    )}
                    {decision !== 'Approve' && <Field label="Reason" hint="Shown to the customer and recorded in the history."><textarea required maxLength={1000} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
                  </div>
                  <footer className="panel-foot"><span className="muted small-text">The customer is notified by email.</span><button className={decision === 'Reject' ? 'danger' : ''} disabled={busy}>{busy ? 'Saving…' : 'Confirm decision'}</button></footer>
                </form>
              )}
              <Panel title="Customer">
                {view.profile ? (
                  <dl className="facts">
                    <dt>Occupation</dt><dd>{view.profile.occupation}</dd>
                    <dt>Date of birth</dt><dd>{dateOnly(view.profile.dob)}</dd>
                    <dt>PAN</dt><dd className="mono">{view.profile.panMasked ?? '–'}</dd>
                    <dt>Aadhaar</dt><dd className="mono">{view.profile.aadhaarMasked ?? '–'}</dd>
                  </dl>
                ) : <Empty>No profile on file.</Empty>}
              </Panel>
              <Panel title="History"><Timeline items={a.history} /></Panel>
            </div>
          </div>
        </>
      )
    }}</Loading>
  )
}

export function AgentTicketsPage() {
  const navigate = useNavigate()
  const state = useLoad(() => api.get<TicketSummary[]>('/agent/tickets'), [])
  return (
    <>
      <PageHead eyebrow="Customer support" title="Tickets" sub="Open tickets appear first. Replies are sent only when you choose to send them." />
      <Loading state={state} lines={6}>{(tickets) => (
        <section className="panel">
          <header className="panel-head"><h2>Inbox</h2><span className="muted">{tickets.filter((t) => t.status !== 'Closed').length} open</span></header>
          {tickets.length === 0 ? <Empty title="No tickets">Customer tickets will appear here.</Empty> : (
            <table>
              <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th className="num">Opened</th></tr></thead>
              <tbody>{tickets.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/agent/tickets/${t.id}`)}>
                  <td><Ref id={t.id} /></td>
                  <td><Link className="primary-text" to={`/agent/tickets/${t.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{t.subject}</Link></td>
                  <td><Badge value={t.status} /></td>
                  <td className="num"><time>{dateTime(t.createdAt)}</time></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}</Loading>
    </>
  )
}

export function AgentTicketPage() {
  const { id } = useParams()
  const state = useLoad(() => api.get<AgentTicket>(`/agent/tickets/${id}`), [id])
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await state.reload() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }

  return (
    <Loading state={state} lines={8}>{({ ticket: t, customer }) => (
      <>
        <PageHead
          eyebrow="Support ticket"
          title={t.subject}
          sub={<>{customer.customerName ?? 'Customer'} · Ticket <Ref id={t.id} /> · {dateTime(t.createdAt)}</>}
          action={<><Link className="button ghost small" to="/agent">← Inbox</Link><Badge value={t.status} /></>}
        />
        <div className="split">
          <div className="stack">
            <section className="panel thread">
              {t.messages.map((m) => (
                <article key={m.id} className={`msg ${m.fromStaff ? 'staff' : ''}`}>
                  <header><b>{m.fromStaff ? 'Support' : customer.customerName ?? 'Customer'}</b><time>{dateTime(m.at)}</time></header>
                  <p>{m.body}</p>
                </article>
              ))}
            </section>
            {t.status !== 'Closed' && (
              <form className="panel" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.post(`/agent/tickets/${id}/reply`, { body }); setBody('') }) }}>
                <div className="panel-body form">
                  <Alert>{error}</Alert>
                  <Field label="Reply to customer" hint="Review carefully. The customer sees exactly what you send."><textarea required maxLength={4000} rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
                </div>
                <footer className="panel-foot">
                  <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/agent/tickets/${id}/close`))}>Close ticket</button>
                  <button disabled={busy}>Send reply</button>
                </footer>
              </form>
            )}
          </div>
          <Panel title="Customer context">
            <div className="eyebrow" style={{ marginBottom: 4 }}>Applications</div>
            {customer.applications.length === 0 ? <p className="muted small-text">None.</p> : (
              <ul className="checklist">{customer.applications.map((a) => <li key={a.id}><span>{a.productName}<span className="sub muted small-text"><Ref id={a.id} /></span></span><Badge value={a.status} /></li>)}</ul>
            )}
            <div className="eyebrow" style={{ margin: '18px 0 4px' }}>Identity documents</div>
            {customer.kyc.length === 0 ? <p className="muted small-text">No documents.</p> : (
              <ul className="checklist">{customer.kyc.map((k) => <li key={k.type}><span>{label(k.type)}</span><Badge value={k.status} /></li>)}</ul>
            )}
          </Panel>
        </div>
      </>
    )}</Loading>
  )
}

export function AuditPage() {
  const [page, setPage] = useState(1)
  const state = useLoad(() => api.get<AuditEntry[]>(`/admin/audit?page=${page}&pageSize=50`), [page])
  return (
    <>
      <PageHead eyebrow="Administration" title="Audit log" sub="Every status change, decision and document view, newest first. Entries cannot be edited." />
      <Loading state={state} lines={10}>{(rows) => (
        <section className="panel">
          {rows.length === 0 ? <Empty title="No entries" /> : (
            <table>
              <thead><tr><th className="num" style={{ textAlign: 'left' }}>When</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Actor</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><time className="muted">{dateTime(r.at)}</time></td>
                  <td className="primary-text">{label(r.action)}</td>
                  <td>{label(r.entityType)}</td>
                  <td><code>{r.entityId.slice(0, 8)}</code></td>
                  <td><code>{r.actorId.slice(0, 8)}</code></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <footer className="panel-foot">
            <span className="muted small-text">Page {page}</span>
            <div className="actions">
              <button className="small secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>← Newer</button>
              <button className="small secondary" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Older →</button>
            </div>
          </footer>
        </section>
      )}</Loading>
    </>
  )
}

export function StaffPage() {
  const [form, setForm] = useState({ email: '', password: '', role: 'Officer' })
  const [error, setError] = useState('')
  const [created, setCreated] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(''); setCreated('')
    try {
      const staff = await api.post<{ email: string; role: string }>('/admin/staff', form)
      setCreated(`${staff.email} was added as ${label(staff.role)}.`)
      setForm({ email: '', password: '', role: form.role })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead eyebrow="Administration" title="Staff accounts" sub="Create officer, support agent and admin accounts. Customers register themselves." />
      <div className="split">
        <form className="panel" onSubmit={submit}>
          <header className="panel-head"><h2>New staff account</h2></header>
          <div className="panel-body form">
            <Alert>{error}</Alert>
            <Alert tone="good">{created}</Alert>
            <Field label="Work email"><input type="email" autoComplete="off" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Temporary password" hint="At least 8 characters, with a letter and a number. Share it privately."><input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="Officer">Officer</option><option value="SupportAgent">Support agent</option><option value="Admin">Admin</option>
              </select>
            </Field>
          </div>
          <footer className="panel-foot"><span /><button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></footer>
        </form>
        <Panel title="Roles">
          <dl className="facts">
            <dt>Officer</dt><dd style={{ fontWeight: 400 }}>Claims applications, reviews KYC, decides</dd>
            <dt>Support agent</dt><dd style={{ fontWeight: 400 }}>Answers customer tickets</dd>
            <dt>Admin</dt><dd style={{ fontWeight: 400 }}>Staff accounts and audit log</dd>
          </dl>
        </Panel>
      </div>
    </>
  )
}
