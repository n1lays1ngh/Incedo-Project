import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { api, login } from '../api'
import { Alert, Field, Wordmark, homeFor, messageOf, useSession } from '../ui'

function Card({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Wordmark />
        <div>
          <h2>Verify once. Apply whenever you're ready.</h2>
          <ul>
            <li><span>01</span>PAN and Aadhaar are encrypted and shown masked.</li>
            <li><span>02</span>Document links expire after five minutes.</li>
            <li><span>03</span>Every status change comes with its reason.</li>
          </ul>
        </div>
        <small>Demonstration project. Use synthetic data only.</small>
      </aside>
      <main className="auth-main">
        <div className="auth-form">
          <Link className="back" to="/">← Back to home</Link>
          <h1>{title}</h1>
          <p>{sub}</p>
          {children}
        </div>
      </main>
    </div>
  )
}

export function LoginPage() {
  const session = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to={homeFor(session.role)} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await login(email, password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith(homeFor(result.role)) ? from : homeFor(result.role), { replace: true })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Sign in" sub="Use your customer or staff account.">
      <form onSubmit={submit} className="form">
        <Alert>{error}</Alert>
        <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="switch">New customer? <Link to="/register">Create an account</Link></p>
    </Card>
  )
}

export function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', phone: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/register', form)
      navigate('/verify', { state: { email: form.email } })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Create your account" sub="We'll email you a code to confirm it's you.">
      <form onSubmit={submit} className="form">
        <Alert>{error}</Alert>
        <Field label="Email"><input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone" hint="10 to 15 digits"><input type="tel" autoComplete="tel" required pattern="\+?[0-9]{10,15}" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Password" hint="At least 8 characters, with a letter and a number"><input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="switch">Already registered? <Link to="/login">Sign in</Link></p>
    </Card>
  )
}

export function VerifyPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/verify-otp', { email, code })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setError('')
    try {
      const result = await api.post<{ message: string }>('/auth/resend-otp', { email })
      setInfo(result.message)
    } catch (err) {
      setError(messageOf(err))
    }
  }

  return (
    <Card title="Verify your email" sub="Enter the 6-digit code we sent you.">
      <form onSubmit={submit} className="form">
        <Alert>{error}</Alert>
        <Alert tone="good">{info}</Alert>
        <Field label="Email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Code"><input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
        <button type="button" className="ghost" disabled={!email} onClick={() => void resend()}>Send a new code</button>
      </form>
    </Card>
  )
}
