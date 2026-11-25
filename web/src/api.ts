const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:5080').replace(/\/$/, '')
const SESSION_KEY = 'bank.session'

export type Role = 'Customer' | 'Officer' | 'SupportAgent' | 'Admin'
export interface Session { refreshToken: string; userId: string; email: string; role: Role }
interface AuthResponse extends Session { accessToken: string }

export interface Profile { name: string; dob: string; address: string; occupation: string; monthlyIncome: number; panMasked: string | null; aadhaarMasked: string | null }
export interface Product { id: number; code: string; name: string; annualInterestRate: number | null }
export interface ApplicationSummary { id: string; productCode: string; productName: string; status: string; createdAt: string }
export interface HistoryItem { fromStatus: string; toStatus: string; reason: string | null; at: string }
export interface KycDocument { id: string; type: string; status: string; rejectReason: string | null; applicationId: string | null; uploadedAt: string }
export interface SavingsInfo { accountVariant: string; nomineeName: string; nomineeRelation: string; consentAt: string | null }
export interface LoanInfo { amount: number; tenureMonths: number; purpose: string; employmentType: string; annualInterestRate: number | null; emi: number | null; emiToIncomeRatio: number | null; highRatioWarning: boolean }
export interface ApplicationDetail extends ApplicationSummary { rejectionCategory: string | null; rejectionReason: string | null; savings: SavingsInfo | null; loan: LoanInfo | null; history: HistoryItem[]; documents: KycDocument[] }
export interface EmiPreview { emi: number; annualInterestRate: number; emiToIncomeRatio: number | null; highRatioWarning: boolean }
export interface Notification { id: string; type: string; message: string; isRead: boolean; createdAt: string }
export interface TicketSummary { id: string; subject: string; status: string; applicationId: string | null; createdAt: string }
export interface TicketMessage { id: string; fromStaff: boolean; body: string; at: string }
export interface TicketDetail extends TicketSummary { messages: TicketMessage[] }
export interface AgentTicket { ticket: TicketDetail; customer: { customerName: string | null; applications: ApplicationSummary[]; kyc: { type: string; status: string }[] } }
export interface QueueItem { id: string; productCode: string; customerName: string; status: string; assignedToMe: boolean; createdAt: string }
export interface OfficerApplication { application: ApplicationDetail; customerId: string; assignedOfficerId: string | null; assignedToMe: boolean; profile: Profile | null }
export interface AuditEntry { id: number; actorId: string; action: string; entityType: string; entityId: string; at: string }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let accessToken: string | null = null
let session: Session | null = readSession()
let refreshing: Promise<boolean> | null = null
const listeners = new Set<(s: Session | null) => void>()

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function setSession(next: AuthResponse | null) {
  accessToken = next?.accessToken ?? null
  session = next ? { refreshToken: next.refreshToken, userId: next.userId, email: next.email, role: next.role } : null
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else sessionStorage.removeItem(SESSION_KEY)
  listeners.forEach((listener) => listener(session))
}

export const getSession = () => session
export const logout = () => setSession(null)
export function subscribe(listener: (s: Session | null) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

async function toError(response: Response): Promise<ApiError> {
  let message = 'Something went wrong. Please try again.'
  try {
    const body = await response.json()
    const firstValidation = body.errors ? (Object.values(body.errors)[0] as string[] | undefined)?.[0] : undefined
    message = firstValidation ?? body.detail ?? body.title ?? message
  } catch { /* keep the generic message */ }
  return new ApiError(response.status, message)
}

function refreshSession(): Promise<boolean> {
  if (!session) return Promise.resolve(false)
  // Refresh tokens rotate on use, so parallel requests must share one refresh call.
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      })
      if (!response.ok) {
        if (response.status === 401) setSession(null)
        return false
      }
      setSession(await response.json())
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  if (!accessToken && session && !path.startsWith('/auth/')) await refreshSession()

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (response.status === 401 && retry && session && !path.startsWith('/auth/')) {
    accessToken = null
    if (await refreshSession()) return request<T>(method, path, body, false)
  }
  if (!response.ok) throw await toError(response)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T,>(path: string) => request<T>('PATCH', path),
}

export async function login(email: string, password: string) {
  const result = await request<AuthResponse>('POST', '/auth/login', { email, password })
  setSession(result)
  return result
}

export async function uploadDocument(type: string, file: File, applicationId?: string) {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png']
  if (!allowed.includes(file.type)) throw new ApiError(400, 'Choose a PDF, JPG, or PNG file.')
  if (file.size > 5 * 1024 * 1024) throw new ApiError(400, 'File must be 5 MB or smaller.')

  const target = await api.post<{ url: string; s3Key: string; headers: Record<string, string> }>('/kyc/upload-url', {
    type, contentType: file.type, sizeBytes: file.size, applicationId: applicationId ?? null,
  })
  const put = await fetch(target.url, { method: 'PUT', headers: target.headers, body: file })
  if (!put.ok) throw new ApiError(put.status, 'Upload failed. Please try again.')
  return api.post<KycDocument>('/kyc/documents', { type, s3Key: target.s3Key, applicationId: applicationId ?? null })
}
