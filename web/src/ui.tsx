import { useCallback, useEffect, useRef, useState } from 'react'
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

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
export const money = (n: number | null | undefined) =>
  n == null ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n)
export const dateTime = (s: string) => new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
export const label = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2')

const tones: Record<string, string> = {
  Approved: 'good', Verified: 'good', Answered: 'good', KycVerified: 'good',
  Rejected: 'bad', ActionRequired: 'warn', KycPending: 'warn', Uploaded: 'warn', Open: 'warn',
  UnderReview: 'info', Submitted: 'info',
}

export const Badge = ({ value }: { value: string }) => <span className={`badge ${tones[value] ?? ''}`}>{label(value)}</span>
export const Alert = ({ children, tone = 'bad' }: { children: ReactNode; tone?: 'bad' | 'warn' | 'good' }) =>
  children ? <div className={`alert ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div> : null
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>
export const Field = ({ label: text, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="field"><span>{text}</span>{children}{hint && <small>{hint}</small>}</label>
)

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return <header className="page-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{action}</header>
}

export function Loading<T>({ state, children }: { state: { data: T | null; error: string; loading: boolean }; children: (data: T) => ReactNode }) {
  if (state.error && state.data === null) return <Alert>{state.error}</Alert>
  if (state.data === null) return <div className="empty">Loading…</div>
  return <>{state.error && <Alert>{state.error}</Alert>}{children(state.data)}</>
}

export function Timeline({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <Empty>No status changes yet.</Empty>
  return (
    <ol className="timeline">
      {items.map((h, i) => (
        <li key={`${h.at}-${i}`}><b>{label(h.toStatus)}</b><time>{dateTime(h.at)}</time>{h.reason && <p>{h.reason}</p>}</li>
      ))}
    </ol>
  )
}

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
    { to: '/app', text: 'Overview', end: true }, { to: '/app/apply', text: 'Apply' }, { to: '/app/kyc', text: 'KYC' },
    { to: '/app/tickets', text: 'Support' }, { to: '/app/profile', text: 'Profile' },
  ],
  Officer: [{ to: '/officer', text: 'Work queue', end: true }],
  SupportAgent: [{ to: '/agent', text: 'Tickets', end: true }],
  Admin: [{ to: '/admin', text: 'Audit log', end: true }, { to: '/admin/staff', text: 'Staff' }],
}

function Bell() {
  const [open, setOpen] = useState(false)
  const state = useLoad(() => api.get<Notification[]>('/notifications'), [])
  const items = state.data ?? []
  const unread = items.filter((n) => !n.isRead).length

  const read = async (n: Notification) => {
    if (n.isRead) return
    await api.patch(`/notifications/${n.id}/read`).catch(() => undefined)
    void state.reload()
  }

  return (
    <div className="bell">
      <button className="ghost" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void state.reload() }}>
        Notifications{unread > 0 && <span className="count">{unread}</span>}
      </button>
      {open && (
        <div className="popover">
          {items.length === 0 && <Empty>You're all caught up.</Empty>}
          {items.map((n) => (
            <button key={n.id} className={`note ${n.isRead ? '' : 'unread'}`} onClick={() => void read(n)}>
              <span>{n.message}</span><time>{dateTime(n.createdAt)}</time>
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
  return (
    <div className="shell">
      <aside>
        <Link to={homeFor(session.role)} className="brand">Bank Portal</Link>
        <nav>{navByRole[session.role].map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.text}</NavLink>)}</nav>
        <div className="who"><span>{session.email}</span><small>{label(session.role)}</small></div>
      </aside>
      <div className="main">
        <div className="topbar">
          <Bell />
          <button className="ghost" onClick={() => { logout(); navigate('/login') }}>Sign out</button>
        </div>
        <main><Outlet /></main>
      </div>
    </div>
  )
}
