import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, uploadDocument } from '../api'
import type { ApplicationDetail, ApplicationSummary, EmiPreview, KycDocument, Notification, Product, Profile, TicketDetail, TicketSummary } from '../api'
import { Alert, Amount, Badge, Empty, Field, Loading, PageHead, Panel, Ref, Skeleton, Timeline, dateOnly, dateTime, label, messageOf, money, percent, useLoad } from '../ui'

const KYC_TYPES = [
  { type: 'Pan', name: 'PAN card' },
  { type: 'Aadhaar', name: 'Aadhaar card' },
  { type: 'AddressProof', name: 'Address proof' },
]
const FINAL = ['Approved', 'Rejected']

export function DashboardPage() {
  const navigate = useNavigate()
  const state = useLoad(async () => {
    const [applications, documents, notifications, tickets] = await Promise.all([
      api.get<ApplicationSummary[]>('/applications'),
      api.get<KycDocument[]>('/kyc/documents'),
      api.get<Notification[]>('/notifications'),
      api.get<TicketSummary[]>('/tickets'),
    ])
    return { applications, documents, notifications, tickets }
  }, [])

  return (
    <>
      <PageHead eyebrow="Overview" title="Your applications" sub="Everything you've applied for, your identity verification, and recent updates." />
      <Loading state={state} lines={6}>{({ applications, documents, notifications, tickets }) => {
        const verified = KYC_TYPES.filter((k) => documents.some((d) => d.type === k.type && !d.applicationId && d.status === 'Verified')).length
        const inProgress = applications.filter((a) => !FINAL.includes(a.status) && a.status !== 'Draft').length
        const approved = applications.filter((a) => a.status === 'Approved').length
        const openTickets = tickets.filter((t) => t.status !== 'Closed').length
        return (
          <>
            <section className="figures" aria-label="Summary">
              <div className="figure"><span className="eyebrow">In progress</span><span className="value">{inProgress}</span><p>Submitted and awaiting a decision</p></div>
              <div className="figure"><span className="eyebrow">Approved</span><span className="value">{approved}</span><p>Accounts and loans approved</p></div>
              <div className="figure"><span className="eyebrow">KYC verified</span><span className="value">{verified}<small>/ {KYC_TYPES.length}</small></span><p>{verified === KYC_TYPES.length ? 'Complete and reusable' : 'Documents still needed'}</p></div>
              <div className="figure"><span className="eyebrow">Open tickets</span><span className="value">{openTickets}</span><p>Conversations with support</p></div>
            </section>

            <nav className="quick" aria-label="Quick actions">
              <Link to="/app/apply"><b>Open a savings account</b><span>Regular, Salary or Student</span></Link>
              <Link to="/app/apply?product=LOAN"><b>Apply for a loan</b><span>See your EMI before you apply</span></Link>
              <Link to="/app/kyc"><b>Upload KYC documents</b><span>PAN, Aadhaar, address proof</span></Link>
              <Link to="/app/tickets"><b>Contact support</b><span>A person replies to every ticket</span></Link>
            </nav>

            <div className="split">
              <section className="panel">
                <header className="panel-head"><h2>Applications</h2><span className="muted">{applications.length} total</span></header>
                {applications.length === 0 ? (
                  <Empty title="No applications yet">Start with a <Link to="/app/apply">savings account</Link> or a <Link to="/app/apply?product=LOAN">personal loan</Link>.</Empty>
                ) : (
                  <table>
                    <thead><tr><th>Reference</th><th>Product</th><th>Status</th><th className="num">Opened</th></tr></thead>
                    <tbody>{applications.map((a) => (
                      <tr key={a.id} className="clickable" onClick={() => navigate(`/app/applications/${a.id}`)}>
                        <td><Ref id={a.id} /></td>
                        <td><Link className="primary-text" to={`/app/applications/${a.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }}>{a.productName}</Link></td>
                        <td><Badge value={a.status} /></td>
                        <td className="num"><time>{dateOnly(a.createdAt)}</time></td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </section>

              <div className="stack">
                <Panel title="Identity verification" meta={`${verified} of ${KYC_TYPES.length}`}>
                  <div className="progress" aria-hidden="true"><span style={{ width: `${(verified / KYC_TYPES.length) * 100}%` }} /></div>
                  <ul className="checklist">
                    {KYC_TYPES.map((k) => {
                      const doc = documents.find((d) => d.type === k.type && !d.applicationId)
                      return <li key={k.type}><span>{k.name}</span>{doc ? <Badge value={doc.status} /> : <span className="muted small-text">Not uploaded</span>}</li>
                    })}
                  </ul>
                  {verified < KYC_TYPES.length && <div style={{ marginTop: 12 }}><Link className="button secondary small" to="/app/kyc">Manage documents</Link></div>}
                </Panel>
                <Panel title="Recent activity" body={false}>
                  {notifications.length === 0 ? <Empty>No updates yet.</Empty> : (
                    <div className="panel-body tight">
                      <ul className="checklist">
                        {notifications.slice(0, 5).map((n) => (
                          <li key={n.id} style={{ display: 'block' }}><span style={{ fontWeight: n.isRead ? 400 : 500 }}>{n.message}</span><time className="muted" style={{ display: 'block', fontSize: 12 }}>{dateTime(n.createdAt)}</time></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Panel>
              </div>
            </div>
          </>
        )
      }}</Loading>
    </>
  )
}

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ name: '', dob: '', address: '', occupation: '', monthlyIncome: '', pan: '', aadhaar: '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = (p: Profile) => {
    setProfile(p)
    setForm({ name: p.name, dob: p.dob, address: p.address, occupation: p.occupation, monthlyIncome: String(p.monthlyIncome), pan: '', aadhaar: '' })
  }

  useEffect(() => {
    api.get<Profile>('/me/profile').then(apply)
      .catch((e) => { if (!(e instanceof ApiError && e.status === 404)) setError(messageOf(e)) })
      .finally(() => setLoaded(true))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(''); setSaved(false)
    try {
      apply(await api.put<Profile>('/me/profile', { ...form, monthlyIncome: Number(form.monthlyIncome), pan: form.pan || null, aadhaar: form.aadhaar || null }))
      setSaved(true)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  return (
    <>
      <PageHead eyebrow="Profile" title="Personal details" sub="Used for every application. PAN and Aadhaar are encrypted when stored and only ever shown masked." />
      {!loaded ? <div className="panel"><Skeleton lines={8} /></div> : (
        <div className="split">
          <form className="panel" onSubmit={submit}>
            <header className="panel-head"><h2>{profile ? 'Update your details' : 'Complete your profile'}</h2></header>
            <div className="panel-body form">
              <Alert>{error}</Alert>
              <Alert tone="good">{saved ? 'Your profile has been saved.' : ''}</Alert>
              <div className="grid">
                <Field label="Full name"><input required maxLength={120} autoComplete="name" value={form.name} onChange={set('name')} /></Field>
                <Field label="Date of birth"><input type="date" required value={form.dob} onChange={set('dob')} /></Field>
                <Field label="Occupation"><input required maxLength={120} value={form.occupation} onChange={set('occupation')} /></Field>
                <Field label="Monthly income (₹)"><input type="number" min="0" step="1" required value={form.monthlyIncome} onChange={set('monthlyIncome')} /></Field>
                <Field label="PAN" hint={profile?.panMasked ? 'Leave blank to keep the PAN on file' : 'Format: ABCDE1234F'}><input autoComplete="off" spellCheck={false} maxLength={10} required={!profile?.panMasked} value={form.pan} onChange={set('pan')} style={{ fontFamily: 'var(--mono)' }} /></Field>
                <Field label="Aadhaar" hint={profile?.aadhaarMasked ? 'Leave blank to keep the Aadhaar on file' : '12 digits'}><input autoComplete="off" inputMode="numeric" maxLength={14} required={!profile?.aadhaarMasked} value={form.aadhaar} onChange={set('aadhaar')} style={{ fontFamily: 'var(--mono)' }} /></Field>
              </div>
              <Field label="Address"><textarea required maxLength={400} rows={3} autoComplete="street-address" value={form.address} onChange={set('address')} /></Field>
            </div>
            <footer className="panel-foot"><span className="muted small-text">Changes apply to future applications.</span><button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></footer>
          </form>
          <Panel title="On file">
            {profile ? (
              <dl className="facts">
                <dt>Name</dt><dd>{profile.name}</dd>
                <dt>Monthly income</dt><dd><Amount value={profile.monthlyIncome} /></dd>
                <dt>PAN</dt><dd className="mono">{profile.panMasked ?? '–'}</dd>
                <dt>Aadhaar</dt><dd className="mono">{profile.aadhaarMasked ?? '–'}</dd>
              </dl>
            ) : <Empty title="Nothing on file yet">Save your details to apply for a product.</Empty>}
          </Panel>
        </div>
      )}
    </>
  )
}

function UploadControl({ type, applicationId, onDone, text = 'Upload' }: { type: string; applicationId?: string; onDone: () => void; text?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="upload">
      <label className={`button secondary small ${busy ? 'disabled' : ''}`}>
        {busy ? 'Uploading…' : text}
        <input type="file" hidden disabled={busy} accept="application/pdf,image/jpeg,image/png" onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true); setError('')
          try { await uploadDocument(type, file, applicationId); onDone() } catch (err) { setError(messageOf(err)) } finally { setBusy(false) }
        }} />
      </label>
      {error && <small className="error">{error}</small>}
    </div>
  )
}

export function KycPage() {
  const state = useLoad(() => api.get<KycDocument[]>('/kyc/documents'), [])
  return (
    <>
      <PageHead eyebrow="KYC documents" title="Verify your identity" sub="Upload each document once. After an officer verifies them, they're reused for every application. PDF, JPG or PNG, up to 5 MB." />
      <Loading state={state} lines={4}>{(documents) => {
        const verified = KYC_TYPES.filter((k) => documents.some((d) => d.type === k.type && !d.applicationId && d.status === 'Verified')).length
        return (
          <div className="split">
            <section className="panel">
              <header className="panel-head"><h2>Required documents</h2><span className="muted">{verified} of {KYC_TYPES.length} verified</span></header>
              <table>
                <thead><tr><th>Document</th><th>Status</th><th className="right">Action</th></tr></thead>
                <tbody>{KYC_TYPES.map((k) => {
                  const doc = documents.find((d) => d.type === k.type && !d.applicationId)
                  return (
                    <tr key={k.type}>
                      <td><span className="primary-text">{k.name}</span>{doc?.rejectReason && <span className="sub error">Rejected: {doc.rejectReason}</span>}{doc && <span className="sub">Uploaded {dateOnly(doc.uploadedAt)}</span>}</td>
                      <td>{doc ? <Badge value={doc.status} /> : <span className="muted small-text">Not uploaded</span>}</td>
                      <td className="right">{doc?.status === 'Verified' ? <span className="muted small-text">No action needed</span> : <UploadControl type={k.type} text={doc ? 'Replace' : 'Upload'} onDone={() => void state.reload()} />}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </section>
            <Panel title="What happens next">
              <ol className="timeline">
                <li className={verified === 0 ? 'current' : ''}><b>Upload</b><time>Each file is checked for type and size</time></li>
                <li className={verified > 0 && verified < KYC_TYPES.length ? 'current' : ''}><b>Officer review</b><time>An officer verifies each document</time></li>
                <li className={verified === KYC_TYPES.length ? 'current' : ''}><b>Verified</b><time>Waiting applications move to review automatically</time></li>
              </ol>
            </Panel>
          </div>
        )
      }}</Loading>
    </>
  )
}

export function ApplyPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const products = useLoad(() => api.get<Product[]>('/products'), [])
  const [code, setCode] = useState(params.get('product') === 'LOAN' ? 'LOAN' : 'SAVINGS')
  const [savings, setSavings] = useState({ accountVariant: 'Regular', nomineeName: '', nomineeRelation: '', consent: false })
  const [loan, setLoan] = useState({ amount: '500000', tenureMonths: '36', purpose: '', employmentType: 'Salaried' })
  const [preview, setPreview] = useState<EmiPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (code !== 'LOAN') return
    const amount = Number(loan.amount)
    const tenureMonths = Number(loan.tenureMonths)
    if (amount < 10000 || amount > 5000000 || tenureMonths < 6 || tenureMonths > 360) { setPreview(null); return }
    let current = true
    const timer = setTimeout(() => {
      api.post<EmiPreview>('/loans/emi-preview', { amount, tenureMonths })
        .then((p) => { if (current) setPreview(p) })
        .catch(() => { if (current) setPreview(null) })
    }, 300)
    return () => { current = false; clearTimeout(timer) }
  }, [code, loan.amount, loan.tenureMonths])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const body = code === 'SAVINGS'
        ? { productCode: code, savings }
        : { productCode: code, loan: { ...loan, amount: Number(loan.amount), tenureMonths: Number(loan.tenureMonths) } }
      const created = await api.post<ApplicationDetail>('/applications', body)
      navigate(`/app/applications/${created.id}`)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead eyebrow="New application" title={code === 'LOAN' ? 'Apply for a personal loan' : 'Open a savings account'} sub="We'll save this as a draft. You can add documents and submit it on the next page." />
      <Loading state={products} lines={6}>{(items) => (
        <form className="panel" onSubmit={submit}>
          <header className="panel-head">
            <div className="tabs" role="tablist" aria-label="Product">
              {items.map((p) => <button type="button" role="tab" aria-selected={code === p.code} className={code === p.code ? 'active' : ''} key={p.code} onClick={() => setCode(p.code)}>{p.name}</button>)}
            </div>
          </header>
          <div className="panel-body form">
            <Alert>{error}</Alert>
            {code === 'SAVINGS' ? (
              <>
                <div className="grid">
                  <Field label="Account type">
                    <select value={savings.accountVariant} onChange={(e) => setSavings({ ...savings, accountVariant: e.target.value })}>
                      <option>Regular</option><option>Salary</option><option>Student</option>
                    </select>
                  </Field>
                  <span />
                  <Field label="Nominee name"><input required maxLength={120} value={savings.nomineeName} onChange={(e) => setSavings({ ...savings, nomineeName: e.target.value })} /></Field>
                  <Field label="Nominee's relationship to you"><input required maxLength={60} value={savings.nomineeRelation} onChange={(e) => setSavings({ ...savings, nomineeRelation: e.target.value })} /></Field>
                </div>
                <label className="check"><input type="checkbox" required checked={savings.consent} onChange={(e) => setSavings({ ...savings, consent: e.target.checked })} /><span>I consent to opening this account and to my KYC documents being verified.</span></label>
              </>
            ) : (
              <>
                <div className="grid">
                  <Field label="Loan amount (₹)" hint="₹10,000 to ₹50,00,000"><input type="number" required min={10000} max={5000000} value={loan.amount} onChange={(e) => setLoan({ ...loan, amount: e.target.value })} /></Field>
                  <Field label="Tenure (months)" hint="6 to 360"><input type="number" required min={6} max={360} value={loan.tenureMonths} onChange={(e) => setLoan({ ...loan, tenureMonths: e.target.value })} /></Field>
                  <Field label="Purpose"><input required maxLength={200} value={loan.purpose} onChange={(e) => setLoan({ ...loan, purpose: e.target.value })} /></Field>
                  <Field label="Employment">
                    <select value={loan.employmentType} onChange={(e) => setLoan({ ...loan, employmentType: e.target.value })}>
                      <option value="Salaried">Salaried</option><option value="SelfEmployed">Self-employed</option>
                    </select>
                  </Field>
                </div>
                <div className="emi" aria-live="polite">
                  <div><small>Monthly EMI</small><strong>{preview ? money(preview.emi) : '–'}</strong></div>
                  <div><small>Interest rate</small><strong>{preview ? `${preview.annualInterestRate.toFixed(2)}%` : '–'}</strong></div>
                  <div><small>EMI to income</small><strong className={preview?.highRatioWarning ? 'warn-text' : ''}>{preview ? (preview.emiToIncomeRatio == null ? 'Add income' : percent(preview.emiToIncomeRatio)) : '–'}</strong></div>
                </div>
                {preview?.highRatioWarning && <Alert tone="warn">This EMI is more than 50% of your monthly income. You can still apply. An officer will take it into account.</Alert>}
                <p className="muted small-text">You'll need to attach a recent salary slip before you can submit.</p>
              </>
            )}
          </div>
          <footer className="panel-foot"><span className="muted small-text">Nothing is sent for review until you submit.</span><button disabled={busy}>{busy ? 'Saving…' : 'Save draft and continue'}</button></footer>
        </form>
      )}</Loading>
    </>
  )
}

export function ApplicationPage() {
  const { id } = useParams()
  const state = useLoad(() => api.get<ApplicationDetail>(`/applications/${id}`), [id])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true); setError('')
    try { await api.post(`/applications/${id}/submit`); await state.reload() } catch (err) { setError(messageOf(err)) } finally { setBusy(false) }
  }

  return (
    <Loading state={state} lines={8}>{(a) => {
      const editable = a.status === 'Draft' || a.status === 'ActionRequired'
      const slip = a.documents.find((d) => d.type === 'SalarySlip')
      const lastReason = a.status === 'ActionRequired' ? a.history.at(-1)?.reason : null
      return (
        <>
          <PageHead
            eyebrow={a.productCode === 'LOAN' ? 'Personal loan' : 'Savings account'}
            title={a.productName}
            sub={<>Reference <Ref id={a.id} /> · Opened {dateTime(a.createdAt)}</>}
            action={<Badge value={a.status} />}
          />
          <Alert>{error}</Alert>
          {lastReason && <Alert tone="warn"><span><b>Action needed.</b> {lastReason}</span></Alert>}
          {a.status === 'Rejected' && <Alert><span><b>Not approved{a.rejectionCategory ? ` · ${label(a.rejectionCategory)}` : ''}.</b> {a.rejectionReason}</span></Alert>}
          {a.status === 'KycPending' && <Alert tone="warn"><span>Waiting for your identity documents to be verified. <Link to="/app/kyc">Check your documents</Link>.</span></Alert>}
          {a.status === 'Approved' && <Alert tone="good"><span><b>Approved.</b> We've emailed you the details.</span></Alert>}
          <div className="split">
            <div className="stack">
              <Panel title="Details">
                {a.savings && <dl className="facts"><dt>Account type</dt><dd>{a.savings.accountVariant}</dd><dt>Nominee</dt><dd>{a.savings.nomineeName} ({a.savings.nomineeRelation})</dd></dl>}
                {a.loan && (
                  <dl className="facts">
                    <dt>Amount</dt><dd><Amount value={a.loan.amount} /></dd>
                    <dt>Tenure</dt><dd>{a.loan.tenureMonths} months</dd>
                    {a.loan.annualInterestRate != null && <><dt>Interest rate</dt><dd>{a.loan.annualInterestRate.toFixed(2)}% p.a.</dd></>}
                    {a.loan.emi != null && <><dt>Monthly EMI</dt><dd><Amount value={a.loan.emi} /></dd></>}
                    {a.loan.emiToIncomeRatio != null && <><dt>EMI to income</dt><dd>{percent(a.loan.emiToIncomeRatio)}</dd></>}
                    <dt>Purpose</dt><dd>{a.loan.purpose}</dd>
                    <dt>Employment</dt><dd>{label(a.loan.employmentType)}</dd>
                  </dl>
                )}
              </Panel>
              {a.productCode === 'LOAN' && (
                <Panel title="Salary slip">
                  <div className="row">
                    <div>{slip ? <span className="primary-text">Salary slip attached</span> : <><span className="primary-text">No salary slip yet</span><p className="muted">Required before you can submit.</p></>}</div>
                    <div className="row-end">
                      {slip && <Badge value={slip.status} />}
                      {editable && <UploadControl type="SalarySlip" applicationId={a.id} text={slip ? 'Replace' : 'Upload'} onDone={() => void state.reload()} />}
                    </div>
                  </div>
                </Panel>
              )}
              {editable && (
                <div className="actions">
                  <button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : a.status === 'Draft' ? 'Submit application' : 'Resubmit application'}</button>
                  <span className="muted small-text">An officer will review it after submission.</span>
                </div>
              )}
            </div>
            <Panel title="Status history" foot={<Link to={`/app/tickets?applicationId=${a.id}`}>Questions about this application?</Link>}>
              <Timeline items={a.history} />
            </Panel>
          </div>
        </>
      )
    }}</Loading>
  )
}

export function TicketsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const applicationId = params.get('applicationId')
  const state = useLoad(() => api.get<TicketSummary[]>('/tickets'), [])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const ticket = await api.post<TicketDetail>('/tickets', { subject, body, applicationId })
      navigate(`/app/tickets/${ticket.id}`)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead eyebrow="Support" title="Help with your account" sub="Raise a ticket and a member of our support team will reply here." />
      <div className="split">
        <section className="panel">
          <header className="panel-head"><h2>Your tickets</h2></header>
          <Loading state={state} lines={4}>{(tickets) => tickets.length === 0 ? <Empty title="No tickets yet">Use the form to ask us anything.</Empty> : (
            <table>
              <thead><tr><th>Subject</th><th>Status</th><th className="num">Opened</th></tr></thead>
              <tbody>{tickets.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/app/tickets/${t.id}`)}>
                  <td><Link className="primary-text" to={`/app/tickets/${t.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>{t.subject}</Link></td>
                  <td><Badge value={t.status} /></td>
                  <td className="num"><time>{dateOnly(t.createdAt)}</time></td>
                </tr>
              ))}</tbody>
            </table>
          )}</Loading>
        </section>
        <form className="panel" onSubmit={submit}>
          <header className="panel-head"><h2>New ticket</h2>{applicationId && <span className="muted">Linked to <Ref id={applicationId} /></span>}</header>
          <div className="panel-body form">
            <Alert>{error}</Alert>
            <Field label="Subject"><input required maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="How can we help?" hint="Please don't include your full PAN or Aadhaar number."><textarea required maxLength={4000} rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <div><button disabled={busy}>{busy ? 'Sending…' : 'Send to support'}</button></div>
          </div>
        </form>
      </div>
    </>
  )
}

export function TicketPage() {
  const { id } = useParams()
  const state = useLoad(() => api.get<TicketDetail>(`/tickets/${id}`), [id])
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try { await api.post(`/tickets/${id}/messages`, { body }); setBody(''); await state.reload() } catch (err) { setError(messageOf(err)) } finally { setBusy(false) }
  }

  return (
    <Loading state={state} lines={6}>{(t) => (
      <>
        <PageHead eyebrow="Support ticket" title={t.subject} sub={<>Ticket <Ref id={t.id} /> · Opened {dateTime(t.createdAt)}</>} action={<Badge value={t.status} />} />
        <section className="panel thread">
          {t.messages.map((m) => (
            <article key={m.id} className={`msg ${m.fromStaff ? 'staff' : ''}`}>
              <header><b>{m.fromStaff ? 'Bank Portal support' : 'You'}</b><time>{dateTime(m.at)}</time></header>
              <p>{m.body}</p>
            </article>
          ))}
        </section>
        {t.status !== 'Closed' ? (
          <form className="panel" onSubmit={send}>
            <div className="panel-body form">
              <Alert>{error}</Alert>
              <Field label="Your reply"><textarea required maxLength={4000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
              <div><button disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button></div>
            </div>
          </form>
        ) : <Empty>This ticket is closed. Raise a new ticket if you need more help.</Empty>}
      </>
    )}</Loading>
  )
}
