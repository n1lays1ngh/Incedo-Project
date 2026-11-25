import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { getSession } from './api'
import { LoginPage, RegisterPage, VerifyPage } from './pages/Auth'
import { ApplicationPage, ApplyPage, DashboardPage, KycPage, ProfilePage, TicketPage, TicketsPage } from './pages/Customer'
import { AgentTicketPage, AgentTicketsPage, AuditPage, QueuePage, ReviewPage, StaffPage } from './pages/Staff'
import { Layout, RequireRole, homeFor } from './ui'

function Home() {
  const session = getSession()
  return <Navigate to={session ? homeFor(session.role) : '/login'} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify" element={<VerifyPage />} />

        <Route element={<RequireRole roles={['Customer']} />}>
          <Route path="/app" element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="kyc" element={<KycPage />} />
            <Route path="apply" element={<ApplyPage />} />
            <Route path="applications/:id" element={<ApplicationPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/:id" element={<TicketPage />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['Officer']} />}>
          <Route path="/officer" element={<Layout />}>
            <Route index element={<QueuePage />} />
            <Route path="applications/:id" element={<ReviewPage />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['SupportAgent']} />}>
          <Route path="/agent" element={<Layout />}>
            <Route index element={<AgentTicketsPage />} />
            <Route path="tickets/:id" element={<AgentTicketPage />} />
          </Route>
        </Route>

        <Route element={<RequireRole roles={['Admin']} />}>
          <Route path="/admin" element={<Layout />}>
            <Route index element={<AuditPage />} />
            <Route path="staff" element={<StaffPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}
