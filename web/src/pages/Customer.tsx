import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, uploadDocument } from '../api'
import type { ApplicationDetail, ApplicationSummary, EmiPreview, KycDocument, Product, Profile, TicketDetail, TicketSummary } from '../api'
import { Alert, Badge, Empty, Field, Loading, PageHead, Timeline, dateTime, label, messageOf, money, useLoad } from '../ui'

const KYC_TYPES = [
  { type: 'Pan', name: 'PAN card' },
  { type: 'Aadhaar', name: 'Aadhaar card' },
  { type: 'AddressProof', name: 'Address proof' },
]

export function DashboardPage() {
  const state = useLoad(async () => {
    const [applications, documents] = await Promise.all([
      api.get<ApplicationSummary[]>('/applications'),
      api.get<KycDocument[]>('/kyc/documents'),
    ])
    return { applications, documents }
  }, [])

  return (
    <>
      <PageHead title="Overview" sub="Your applications and verification status." action={<Link className="button" to="/app/apply">New application</Link>} />
      <Loading state={state}>{({ applications, documents }) => {
        const verified = KYC_TYPES.filter((k) => documents.some((d) => d.type === k.type && d.status === 'Verified')).length
        return (
          <>
            <section className="card kyc-strip">
              <div><b>KYC: {verified} of {KYC_TYPES.length} documents verified</b><p>Verified documents are reused for future applications.</p></div>
              {verified < KYC_TYPES.length && <Link className="button secondary" to="/app/kyc">Manage KYC</Link>}
            </section>
            <section className="card">
              <h2>Applications</h2>
              {applications.length === 0 ? <Empty>No applications yet. <Link to="/app/apply">Start one</Link>.</Empty> : (
                <table>
                  <thead><tr><th>Product</th><th>Status</th><th>Created</th><th /></tr></thead>
                  <tbody>{applications.map((a) => (
                    <tr key={a.id}><td>{a.productName}</td><td><Badge value={a.status} /></td><td>{dateTime(a.createdAt)}</td><td className="right"><Link to={`/app/applications/${a.id}`}>Open</Link></td></tr>
                  ))}</tbody>
                </table>
              )}
            </section>
          </>
        )
      }}</Loading>
    </>
  )
}

export function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [form, setForm] = useState({ name: '', dob: '', address: '', occupation: '', monthlyIncome: '', pan: '', aadhaar: '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const apply = (p: Profile) => {
    setProfile(p)
    setForm({ name: p.name, dob: p.dob, address: p.address, occupation: p.occupation, monthlyIncome: String(p.monthlyIncome), pan: '', aadhaar: '' })
  }

  useEffect(() => {
    api.get<Profile>('/me/profile').then(apply).catch((e) => { if (!(e instanceof ApiError && e.status === 404)) setError(messageOf(e)) })
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
      <PageHead title="Profile" sub="PAN and Aadhaar are encrypted and only ever shown masked." />
      <form className="card form" onSubmit={submit}>
        <Alert>{error}</Alert>
        <Alert tone="good">{saved ? 'Profile saved.' : ''}</Alert>
        <div className="grid">
          <Field label="Full name"><input required maxLength={120} value={form.name} onChange={set('name')} /></Field>
          <Field label="Date of birth"><input type="date" required value={form.dob} onChange={set('dob')} /></Field>
          <Field label="Occupation"><input required maxLength={120} value={form.occupation} onChange={set('occupation')} /></Field>
          <Field label="Monthly income (₹)"><input type="number" min="0" step="1" required value={form.monthlyIncome} onChange={set('monthlyIncome')} /></Field>
          <Field label="PAN" hint={profile?.panMasked ? `On file: ${profile.panMasked}` : 'Example format: ABCDE1234F'}><input autoComplete="off" maxLength={10} required={!profile?.panMasked} value={form.pan} onChange={set('pan')} /></Field>
          <Field label="Aadhaar" hint={profile?.aadhaarMasked ? `On file: ${profile.aadhaarMasked}` : '12 digits'}><input autoComplete="off" inputMode="numeric" maxLength={14} required={!profile?.aadhaarMasked} value={form.aadhaar} onChange={set('aadhaar')} /></Field>
        </div>
        <Field label="Address"><textarea required maxLength={400} rows={3} value={form.address} onChange={set('address')} /></Field>
        <div><button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
      </form>
    </>
  )
}

function UploadControl({ type, applicationId, onDone, text = 'Upload' }: { type: string; applicationId?: string; onDone: () => void; text?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="upload">
      <label className={`button secondary ${busy ? 'disabled' : ''}`}>
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
      <PageHead title="KYC documents" sub="PDF, JPG, or PNG, up to 5 MB each." />
      <Loading state={state}>{(documents) => (
        <section className="card list">
          {KYC_TYPES.map((k) => {
            const doc = documents.find((d) => d.type === k.type && !d.applicationId)
            return (
              <div className="row" key={k.type}>
                <div><b>{k.name}</b>{doc?.rejectReason && <p className="error">{doc.rejectReason}</p>}</div>
                <div className="row-end">
                  {doc ? <Badge value={doc.status} /> : <span className="muted">Not uploaded</span>}
                  {doc?.status !== 'Verified' && <UploadControl type={k.type} text={doc ? 'Replace' : 'Upload'} onDone={() => void state.reload()} />}
                </div>
              </div>
            )
          })}
        </section>
      )}</Loading>
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
      <PageHead title="New application" sub="Save a draft, add documents, then submit." />
      <Loading state={products}>{(items) => (
        <form className="card form" onSubmit={submit}>
          <Alert>{error}</Alert>
          <div className="tabs" role="tablist">
            {items.map((p) => <button type="button" role="tab" aria-selected={code === p.code} className={code === p.code ? 'active' : ''} key={p.code} onClick={() => setCode(p.code)}>{p.name}</button>)}
          </div>
          {code === 'SAVINGS' ? (
            <>
              <div className="grid">
                <Field label="Account type">
                  <select value={savings.accountVariant} onChange={(e) => setSavings({ ...savings, accountVariant: e.target.value })}>
                    <option>Regular</option><option>Salary</option><option>Student</option>
                  </select>
                </Field>
                <Field label="Nominee name"><input required maxLength={120} value={savings.nomineeName} onChange={(e) => setSavings({ ...savings, nomineeName: e.target.value })} /></Field>
                <Field label="Nominee relation"><input required maxLength={60} value={savings.nomineeRelation} onChange={(e) => setSavings({ ...savings, nomineeRelation: e.target.value })} /></Field>
              </div>
              <label className="check"><input type="checkbox" required checked={savings.consent} onChange={(e) => setSavings({ ...savings, consent: e.target.checked })} /> I consent to opening this account and to KYC verification.</label>
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
              {preview && (
                <div className="emi">
                  <div><small>Estimated EMI</small><strong>{money(preview.emi)}</strong></div>
                  <div><small>Interest rate</small><strong>{preview.annualInterestRate}% p.a.</strong></div>
                  <div><small>EMI to income</small><strong>{preview.emiToIncomeRatio == null ? 'Add income' : `${(preview.emiToIncomeRatio * 100).toFixed(1)}%`}</strong></div>
                </div>
              )}
              {preview?.highRatioWarning && <Alert tone="warn">This EMI is more than 50% of your monthly income. You can still apply, and an officer will review it.</Alert>}
            </>
          )}
          <div><button disabled={busy}>{busy ? 'Saving…' : 'Save draft and continue'}</button></div>
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
    <Loading state={state}>{(a) => {
      const editable = a.status === 'Draft' || a.status === 'ActionRequired'
      const slip = a.documents.find((d) => d.type === 'SalarySlip')
      const lastReason = a.status === 'ActionRequired' ? a.history.at(-1)?.reason : null
      return (
        <>
          <PageHead title={a.productName} sub={`Created ${dateTime(a.createdAt)}`} action={<Badge value={a.status} />} />
          <Alert>{error}</Alert>
          {lastReason && <Alert tone="warn">Action needed: {lastReason}</Alert>}
          {a.status === 'Rejected' && <Alert>Rejected{a.rejectionCategory ? ` (${label(a.rejectionCategory)})` : ''}: {a.rejectionReason}</Alert>}
          {a.status === 'KycPending' && <Alert tone="warn">Waiting for KYC. <Link to="/app/kyc">Check your documents</Link>.</Alert>}
          <div className="columns">
            <div className="stack">
              <section className="card">
                <h2>Details</h2>
                {a.savings && <dl><dt>Account type</dt><dd>{a.savings.accountVariant}</dd><dt>Nominee</dt><dd>{a.savings.nomineeName} ({a.savings.nomineeRelation})</dd></dl>}
                {a.loan && <dl><dt>Amount</dt><dd>{money(a.loan.amount)}</dd><dt>Tenure</dt><dd>{a.loan.tenureMonths} months</dd><dt>Purpose</dt><dd>{a.loan.purpose}</dd><dt>Employment</dt><dd>{label(a.loan.employmentType)}</dd>{a.loan.emi != null && <><dt>EMI</dt><dd>{money(a.loan.emi)}</dd></>}</dl>}
              </section>
              {a.productCode === 'LOAN' && (
                <section className="card">
                  <div className="row">
                    <div><b>Salary slip</b>{!slip && <p className="muted">Required before you can submit.</p>}</div>
                    <div className="row-end">
                      {slip && <Badge value={slip.status} />}
                      {editable && <UploadControl type="SalarySlip" applicationId={a.id} text={slip ? 'Replace' : 'Upload'} onDone={() => void state.reload()} />}
                    </div>
                  </div>
                </section>
              )}
              {editable && <div><button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : a.status === 'Draft' ? 'Submit application' : 'Resubmit application'}</button></div>}
            </div>
            <section className="card">
              <h2>Status history</h2>
              <Timeline items={a.history} />
              <Link className="help" to={`/app/tickets?applicationId=${a.id}`}>Need help with this application?</Link>
            </section>
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
      <PageHead title="Support" sub="Raise a ticket and our team will reply here." />
      <div className="columns">
        <section className="card">
          <h2>Your tickets</h2>
          <Loading state={state}>{(tickets) => tickets.length === 0 ? <Empty>No tickets yet.</Empty> : (
            <div className="list">{tickets.map((t) => (
              <Link className="row link" to={`/app/tickets/${t.id}`} key={t.id}><div><b>{t.subject}</b><p className="muted">{dateTime(t.createdAt)}</p></div><Badge value={t.status} /></Link>
            ))}</div>
          )}</Loading>
        </section>
        <form className="card form" onSubmit={submit}>
          <h2>New ticket</h2>
          {applicationId && <p className="muted">Linked to this application.</p>}
          <Alert>{error}</Alert>
          <Field label="Subject"><input required maxLength={160} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="How can we help?" hint="Please don't include your full PAN or Aadhaar."><textarea required maxLength={4000} rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <div><button disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
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
    <Loading state={state}>{(t) => (
      <>
        <PageHead title={t.subject} sub={`Opened ${dateTime(t.createdAt)}`} action={<Badge value={t.status} />} />
        <section className="card thread">
          {t.messages.map((m) => <div key={m.id} className={`bubble ${m.fromStaff ? 'staff' : 'mine'}`}><small>{m.fromStaff ? 'Support' : 'You'} · {dateTime(m.at)}</small><p>{m.body}</p></div>)}
        </section>
        {t.status !== 'Closed' ? (
          <form className="card form" onSubmit={send}>
            <Alert>{error}</Alert>
            <Field label="Reply"><textarea required maxLength={4000} rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <div><button disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button></div>
          </form>
        ) : <Empty>This ticket is closed.</Empty>}
      </>
    )}</Loading>
  )
}
