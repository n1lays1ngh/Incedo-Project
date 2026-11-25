import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import type { AgentTicket, AuditEntry, KycDocument, OfficerApplication, QueueItem, TicketSummary } from '../api'
import { Alert, Badge, Empty, Field, Loading, PageHead, Timeline, dateTime, label, messageOf, money, useLoad } from '../ui'

export function QueuePage() {
  const state = useLoad(() => api.get<QueueItem[]>('/officer/queue'), [])
  const [error, setError] = useState('')

  const claim = async (id: string) => {
    setError('')
    try { await api.post(`/officer/applications/${id}/claim`) } catch (e) { setError(messageOf(e)) }
    await state.reload()
  }

  return (
    <>
      <PageHead title="Work queue" sub="Unclaimed applications and the ones assigned to you." />
      <Alert>{error}</Alert>
      <Loading state={state}>{(items) => items.length === 0 ? <section className="card"><Empty>The queue is clear.</Empty></section> : (
        <section className="card">
          <table>
            <thead><tr><th>Customer</th><th>Product</th><th>Status</th><th>Received</th><th /></tr></thead>
            <tbody>{items.map((q) => (
              <tr key={q.id}>
                <td>{q.customerName}</td><td>{q.productCode === 'LOAN' ? 'Loan' : 'Savings'}</td><td><Badge value={q.status} /></td><td>{dateTime(q.createdAt)}</td>
                <td className="right">{q.assignedToMe ? <Link to={`/officer/applications/${q.id}`}>Review</Link> : <button className="small" onClick={() => void claim(q.id)}>Pick up</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}</Loading>
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
        <div><b>{label(doc.type)}</b>{doc.rejectReason && <p className="error">{doc.rejectReason}</p>}</div>
        <div className="row-end">
          <Badge value={doc.status} />
          <button className="small secondary" onClick={() => void view()}>View</button>
          {canReview && doc.status === 'Uploaded' && <>
            <button className="small" onClick={() => void run(() => api.post(`/officer/kyc/${doc.id}/verify`))}>Verify</button>
            {!isSlip && <button className="small danger" onClick={() => setRejecting(!rejecting)}>Reject</button>}
          </>}
        </div>
      </div>
      {isSlip && canReview && doc.status === 'Uploaded' && <small className="muted">If this slip is unusable, use Request info below.</small>}
      {rejecting && (
        <div className="inline">
          <input aria-label="Rejection reason" placeholder="Reason shown to the customer" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="small danger" disabled={!reason.trim()} onClick={() => void run(() => api.post(`/officer/kyc/${doc.id}/reject`, { reason }))}>Confirm</button>
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
    <Loading state={state}>{(view) => {
      const a = view.application
      const canReview = view.assignedToMe && (a.status === 'KycPending' || a.status === 'UnderReview')
      return (
        <>
          <PageHead title={`${a.productName}: ${view.profile?.name ?? 'Customer'}`} sub={`Received ${dateTime(a.createdAt)}`} action={<Badge value={a.status} />} />
          {!view.assignedToMe && <Alert tone="warn">This application is not assigned to you, so it is read-only.</Alert>}
          <div className="columns">
            <div className="stack">
              <section className="card">
                <h2>Customer</h2>
                {view.profile ? <dl>
                  <dt>Occupation</dt><dd>{view.profile.occupation}</dd>
                  <dt>Monthly income</dt><dd>{money(view.profile.monthlyIncome)}</dd>
                  <dt>PAN</dt><dd>{view.profile.panMasked ?? '-'}</dd>
                  <dt>Aadhaar</dt><dd>{view.profile.aadhaarMasked ?? '-'}</dd>
                </dl> : <Empty>No profile.</Empty>}
              </section>
              {a.loan && (
                <section className="card">
                  <h2>Eligibility</h2>
                  <dl>
                    <dt>Amount</dt><dd>{money(a.loan.amount)}</dd><dt>Tenure</dt><dd>{a.loan.tenureMonths} months</dd>
                    <dt>Rate</dt><dd>{a.loan.annualInterestRate}% p.a.</dd><dt>EMI</dt><dd>{money(a.loan.emi)}</dd>
                    <dt>EMI to income</dt><dd>{a.loan.emiToIncomeRatio == null ? '-' : `${(a.loan.emiToIncomeRatio * 100).toFixed(1)}%`}</dd>
                    <dt>Purpose</dt><dd>{a.loan.purpose}</dd>
                  </dl>
                  {a.loan.highRatioWarning && <Alert tone="warn">EMI is above 50% of monthly income.</Alert>}
                </section>
              )}
              {a.savings && <section className="card"><h2>Account</h2><dl><dt>Type</dt><dd>{a.savings.accountVariant}</dd><dt>Nominee</dt><dd>{a.savings.nomineeName} ({a.savings.nomineeRelation})</dd></dl></section>}
              <section className="card">
                <h2>Documents</h2>
                {a.documents.length === 0 ? <Empty>No documents uploaded yet.</Empty> : a.documents.map((d) => <DocumentRow key={d.id} doc={d} canReview={canReview} onChange={() => void state.reload()} />)}
              </section>
            </div>
            <div className="stack">
              {view.assignedToMe && a.status === 'UnderReview' && (
                <form className="card form" onSubmit={decide}>
                  <h2>Decision</h2>
                  <Alert>{error}</Alert>
                  <Field label="Outcome">
                    <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                      <option value="Approve">Approve</option><option value="RequestInfo">Request info</option><option value="Reject">Reject</option>
                    </select>
                  </Field>
                  {decision === 'Reject' && (
                    <Field label="Category">
                      <select value={category} onChange={(e) => setCategory(e.target.value)}>
                        {['Eligibility', 'Documents', 'Affordability', 'Policy', 'Other'].map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                  )}
                  {decision !== 'Approve' && <Field label="Reason" hint="Shown to the customer."><textarea required maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
                  <div><button disabled={busy}>{busy ? 'Saving…' : 'Confirm decision'}</button></div>
                </form>
              )}
              <section className="card"><h2>History</h2><Timeline items={a.history} /></section>
            </div>
          </div>
        </>
      )
    }}</Loading>
  )
}

export function AgentTicketsPage() {
  const state = useLoad(() => api.get<TicketSummary[]>('/agent/tickets'), [])
  return (
    <>
      <PageHead title="Support tickets" sub="Open tickets appear first." />
      <Loading state={state}>{(tickets) => tickets.length === 0 ? <section className="card"><Empty>No tickets.</Empty></section> : (
        <section className="card list">{tickets.map((t) => (
          <Link className="row link" key={t.id} to={`/agent/tickets/${t.id}`}><div><b>{t.subject}</b><p className="muted">{dateTime(t.createdAt)}</p></div><Badge value={t.status} /></Link>
        ))}</section>
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
    <Loading state={state}>{({ ticket: t, customer }) => (
      <>
        <PageHead title={t.subject} sub={`${customer.customerName ?? 'Customer'} · ${dateTime(t.createdAt)}`} action={<Badge value={t.status} />} />
        <div className="columns">
          <div className="stack">
            <section className="card thread">
              {t.messages.map((m) => <div key={m.id} className={`bubble ${m.fromStaff ? 'mine' : 'staff'}`}><small>{m.fromStaff ? 'Support' : 'Customer'} · {dateTime(m.at)}</small><p>{m.body}</p></div>)}
            </section>
            {t.status !== 'Closed' && (
              <form className="card form" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.post(`/agent/tickets/${id}/reply`, { body }); setBody('') }) }}>
                <Alert>{error}</Alert>
                <Field label="Reply to customer"><textarea required maxLength={4000} rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
                <div className="actions">
                  <button disabled={busy}>Send reply</button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => api.post(`/agent/tickets/${id}/close`))}>Close ticket</button>
                </div>
              </form>
            )}
          </div>
          <section className="card">
            <h2>Customer context</h2>
            <h3>Applications</h3>
            {customer.applications.length === 0 ? <p className="muted">None.</p> : customer.applications.map((a) => <div className="row" key={a.id}><span>{a.productName}</span><Badge value={a.status} /></div>)}
            <h3>KYC</h3>
            {customer.kyc.length === 0 ? <p className="muted">No documents.</p> : customer.kyc.map((k) => <div className="row" key={k.type}><span>{label(k.type)}</span><Badge value={k.status} /></div>)}
          </section>
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
      <PageHead title="Audit log" sub="Every status change, decision, and document view." />
      <Loading state={state}>{(rows) => (
        <section className="card">
          {rows.length === 0 ? <Empty>No entries.</Empty> : (
            <table>
              <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Actor</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id}><td>{dateTime(r.at)}</td><td>{r.action}</td><td>{r.entityType} <code>{r.entityId.slice(0, 8)}</code></td><td><code>{r.actorId.slice(0, 8)}</code></td></tr>)}</tbody>
            </table>
          )}
          <div className="actions pager">
            <button className="small secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="muted">Page {page}</span>
            <button className="small secondary" disabled={rows.length < 50} onClick={() => setPage(page + 1)}>Next</button>
          </div>
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
      setCreated(`${staff.email} added as ${label(staff.role)}.`)
      setForm({ email: '', password: '', role: form.role })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title="Staff accounts" sub="Create officer, support agent, and admin accounts." />
      <form className="card form narrow" onSubmit={submit}>
        <Alert>{error}</Alert>
        <Alert tone="good">{created}</Alert>
        <Field label="Email"><input type="email" autoComplete="off" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Temporary password" hint="At least 8 characters, with a letter and a number"><input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="Role">
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="Officer">Officer</option><option value="SupportAgent">Support agent</option><option value="Admin">Admin</option>
          </select>
        </Field>
        <div><button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></div>
      </form>
    </>
  )
}
