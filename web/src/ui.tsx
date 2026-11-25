import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DependencyList, ReactNode } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, getSession, logout, subscribe } from './api'
import type { HistoryItem, Notification, Role, Session } from './api'

export function useSession() {
  const [session, setSession] = useState<Session | null>(getSession())
  useEffect(() => subscribe(setSession), [])
  return session
}

export function useLoad<T>(loader: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const latest = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps)

  const reload = useCallback(async () => {
    const run = ++latest.current
    setLoading(true)
    try {
      const result = await load()
      if (run === latest.current) { setData(result); setError('') }
    } catch (e) {
      if (run === latest.current) setError(messageOf(e))
    } finally {
      if (run === latest.current) setLoading(false)
    }
  }, [load])

  useEffect(() => { void reload() }, [reload])
  return { data, error, loading, reload }
}

/* ---------- Formatting ---------- */

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const money = (n: number | null | undefined) => (n == null ? '–' : inr.format(n))
export const percent = (ratio: number | null | undefined) => (ratio == null ? '–' : `${(ratio * 100).toFixed(1)}%`)
export const dateTime = (s: string) => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const dateOnly = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
export const label = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bKyc\b/g, 'KYC')
/** Short, readable reference for an id: first 8 hex characters as XXXX-XXXX. */
export const shortRef = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-')

/* ---------- Privacy: hide amounts app-wide (stored on this device) ---------- */

const PRIVACY_KEY = 'bank.hideAmounts'
const privacyListeners = new Set<() => void>()
const readPrivacy = () => { try { return localStorage.getItem(PRIVACY_KEY) === '1' } catch { return false } }
export function useHideAmounts(): [boolean, (v: boolean) => void] {
  const hidden = useSyncExternalStore((cb) => { privacyListeners.add(cb); return () => { privacyListeners.delete(cb) } }, readPrivacy)
  const set = (v: boolean) => {
    try { localStorage.setItem(PRIVACY_KEY, v ? '1' : '0') } catch { /* storage unavailable */ }
    privacyListeners.forEach((l) => l())
  }
  return [hidden, set]
}

/** A currency amount that respects the hide-amounts toggle. */
export function Amount({ value }: { value: number | null | undefined }) {
  const [hidden] = useHideAmounts()
  if (hidden && value != null) return <span className="amount hidden" aria-label="Amount hidden">₹ ••••••</span>
  return <span className="amount">{money(value)}</span>
}

function PrivacyToggle() {
  const [hidden, setHidden] = useHideAmounts()
  return (
    <button className="ghost small" aria-pressed={hidden} onClick={() => setHidden(!hidden)} title="Hide amounts from people nearby">
      {hidden ? 'Show amounts' : 'Hide amounts'}
    </button>
  )
}

/* ---------- Primitives ---------- */

const settled: Record<string, string> = { Approved: 'good', Verified: 'good', KycVerified: 'good', Answered: 'good', Rejected: 'bad', Closed: '' }
const inProgress: Record<string, string> = { Submitted: 'info', UnderReview: 'info', KycPending: 'warn', ActionRequired: 'warn', Uploaded: 'warn', Open: 'warn', Draft: '' }

/** Filled dot = final outcome; hollow dot = still in progress. */
export function Badge({ value }: { value: string }) {
  const done = value in settled
  const tone = done ? settled[value] : (inProgress[value] ?? '')
  return <span className={`badge ${tone} ${done ? '' : 'pending'}`}>{label(value)}</span>
}

export const Alert = ({ children, tone = 'bad' }: { children: ReactNode; tone?: 'bad' | 'warn' | 'good' }) =>
  children ? <div className={`alert ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div> : null

export const Empty = ({ title, children }: { title?: string; children?: ReactNode }) => (
  <div className="empty">{title && <strong>{title}</strong>}{children}</div>
)

export const Field = ({ label: text, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="field"><span>{text}</span>{children}{hint && <small>{hint}</small>}</label>
)

export function Panel({ title, meta, children, foot, body = true }: { title?: ReactNode; meta?: ReactNode; children: ReactNode; foot?: ReactNode; body?: boolean | 'tight' }) {
  return (
    <section className="panel">
      {title && <header className="panel-head"><h2>{title}</h2>{meta && <span className="muted">{meta}</span>}</header>}
      {body ? <div className={`panel-body ${body === 'tight' ? 'tight' : ''}`}>{children}</div> : children}
      {foot && <footer className="panel-foot">{foot}</footer>}
    </section>
  )
}

export function PageHead({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="page-head">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {action && <div className="actions">{action}</div>}
    </header>
  )
}

/** Mono reference number with copy-to-clipboard feedback. Copies the full id. */
export function Ref({ id, prefix = '' }: { id: string; prefix?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }
  return (
    <span className="ref">
      {prefix}{shortRef(id)}
      <button type="button" className={copied ? 'done' : ''} onClick={(e) => { e.stopPropagation(); e.preventDefault(); void copy() }} aria-label="Copy full reference number">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}

export function Skeleton({ lines = 5 }: { lines?: number }) {
  return <div className="skeleton" aria-busy="true" aria-label="Loading">{Array.from({ length: lines }, (_, i) => <span key={i} />)}</div>
}

export function Loading<T>({ state, lines, children }: { state: { data: T | null; error: string; loading: boolean }; lines?: number; children: (data: T) => ReactNode }) {
  if (state.error && state.data === null) return <Alert>{state.error}</Alert>
  if (state.data === null) return <div className="panel"><Skeleton lines={lines} /></div>
  return <>{state.error && <Alert>{state.error}</Alert>}{children(state.data)}</>
}

/** Status history; the latest entry is highlighted as where the application stands now. */
export function Timeline({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <Empty>No status changes yet.</Empty>
  return (
    <ol className="timeline">
      {items.map((h, i) => (
        <li key={`${h.at}-${i}`} className={i === items.length - 1 ? 'current' : ''}>
          <b>{label(h.toStatus)}</b><time>{dateTime(h.at)}</time>{h.reason && <p>{h.reason}</p>}
        </li>
      ))}
    </ol>
  )
}

export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="wordmark" aria-label="Bank Portal home">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="5" fill="#123B2F" />
        <path d="M8 23.5h16M10 21V12m4 9v-9m4 9v-9m4 9v-9M7.5 10 16 6l8.5 4z" stroke="#F7F6F2" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
      </svg>
      <span>Bank Portal</span>
    </Link>
  )
}

/* ---------- Routing ---------- */

export const homeFor = (role: Role) => ({ Customer: '/app', Officer: '/officer', SupportAgent: '/agent', Admin: '/admin' })[role]

export function RequireRole({ roles }: { roles: Role[] }) {
  const session = useSession()
  const location = useLocation()
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (!roles.includes(session.role)) return <Navigate to={homeFor(session.role)} replace />
  return <Outlet />
}

const navByRole: Record<Role, { to: string; text: string; end?: boolean }[]> = {
  Customer: [
    { to: '/app', text: 'Overview', end: true }, { to: '/app/apply', text: 'Apply' }, { to: '/app/kyc', text: 'KYC documents' },
    { to: '/app/tickets', text: 'Support' }, { to: '/app/profile', text: 'Profile' },
  ],
  Officer: [{ to: '/officer', text: 'Work queue', end: true }],
  SupportAgent: [{ to: '/agent', text: 'Tickets', end: true }],
  Admin: [{ to: '/admin', text: 'Audit log', end: true }, { to: '/admin/staff', text: 'Staff accounts' }],
}

const roleTitle: Record<Role, string> = { Customer: 'Personal banking', Officer: 'Credit operations', SupportAgent: 'Customer support', Admin: 'Administration' }

function Bell() {
  const [open, setOpen] = useState(false)
  const state = useLoad(() => api.get<Notification[]>('/notifications'), [])
  const items = state.data ?? []
  const unread = items.filter((n) => !n.isRead).length
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const read = async (n: Notification) => {
    if (n.isRead) return
    await api.patch(`/notifications/${n.id}/read`).catch(() => undefined)
    void state.reload()
  }

  return (
    <div className="bell" ref={ref}>
      <button className="ghost small" aria-expanded={open} aria-haspopup="true" onClick={() => { setOpen(!open); if (!open) void state.reload() }}>
        Notifications{unread > 0 && <span className="count" aria-label={`${unread} unread`}>{unread}</span>}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <header>Notifications</header>
          {items.length === 0 && <Empty>You're all caught up.</Empty>}
          {items.map((n) => (
            <button key={n.id} className={`note ${n.isRead ? '' : 'unread'}`} onClick={() => void read(n)}>
              <span>{n.message}<time>{dateTime(n.createdAt)}</time></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Layout() {
  const session = useSession()
  const navigate = useNavigate()
  if (!session) return <Navigate to="/login" replace />
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark-wrap"><Wordmark to={homeFor(session.role)} /></div>
        <div className="role eyebrow">{roleTitle[session.role]}</div>
        <nav aria-label="Main">{navByRole[session.role].map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.text}</NavLink>)}</nav>
        <div className="rail-foot"><b>{session.email}</b>{label(session.role)}</div>
      </aside>
      <div>
        <div className="topbar">
          <span className="today">{today}</span>
          <span className="spacer" />
          {session.role !== 'Admin' && <PrivacyToggle />}
          <Bell />
          <span className="divider" />
          <button className="ghost small" onClick={() => { logout(); navigate('/') }}>Sign out</button>
        </div>
        <main className="content"><Outlet /></main>
      </div>
    </div>
  )
}
