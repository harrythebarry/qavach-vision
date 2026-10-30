import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router';
import { AppShell } from './components/AppShell';
import { Toasts } from './components/ui';
import { AppStateProvider, useApp } from './state/AppState';
import { LiveEngine } from './state/engine';
import { SignInPage } from './pages/SignIn';
import { OperationsCenterPage } from './pages/OperationsCenter';

// Each screen loads on first visit; sign-in and the operations center ship in the main bundle.
const VideoWallPage = lazy(() => import('./pages/VideoWall').then((m) => ({ default: m.VideoWallPage })));
const WheelhousePage = lazy(() => import('./pages/Wheelhouse').then((m) => ({ default: m.WheelhousePage })));
const PhoneAlertPage = lazy(() => import('./pages/PhoneAlert').then((m) => ({ default: m.PhoneAlertPage })));
const AlarmConsolePage = lazy(() => import('./pages/alarms/AlarmConsole').then((m) => ({ default: m.AlarmConsolePage })));
const VoyagesPage = lazy(() => import('./pages/voyages/Voyages').then((m) => ({ default: m.VoyagesPage })));
const VoyageRecordPage = lazy(() => import('./pages/voyages/VoyageRecord').then((m) => ({ default: m.VoyageRecordPage })));
const UseCasesPage = lazy(() => import('./pages/config/UseCases').then((m) => ({ default: m.UseCasesPage })));
const CamerasPage = lazy(() => import('./pages/config/Cameras').then((m) => ({ default: m.CamerasPage })));
const AlertRoutingPage = lazy(() => import('./pages/config/AlertRouting').then((m) => ({ default: m.AlertRoutingPage })));
const EdgeUnitsPage = lazy(() => import('./pages/config/EdgeUnits').then((m) => ({ default: m.EdgeUnitsPage })));
const ReportsPage = lazy(() => import('./pages/insights/Reports').then((m) => ({ default: m.ReportsPage })));
const DailySummaryPage = lazy(() => import('./pages/insights/DailySummary').then((m) => ({ default: m.DailySummaryPage })));
const ModelPerformancePage = lazy(() => import('./pages/insights/ModelPerformance').then((m) => ({ default: m.ModelPerformancePage })));
const UsersPage = lazy(() => import('./pages/admin/Users').then((m) => ({ default: m.UsersPage })));
const AuditLogPage = lazy(() => import('./pages/admin/AuditLog').then((m) => ({ default: m.AuditLogPage })));
const IntegrationsPage = lazy(() => import('./pages/admin/Integrations').then((m) => ({ default: m.IntegrationsPage })));
const VideoWallPopoutPage = lazy(() => import('./pages/VideoWallPopout').then((m) => ({ default: m.VideoWallPopoutPage })));
const StatusPage = lazy(() => import('./pages/public/Status').then((m) => ({ default: m.StatusPage })));
const PrivacyPage = lazy(() => import('./pages/public/Privacy').then((m) => ({ default: m.PrivacyPage })));
const SupportPage = lazy(() => import('./pages/public/Support').then((m) => ({ default: m.SupportPage })));
const PlanPage = lazy(() => import('./pages/admin/Plan').then((m) => ({ default: m.PlanPage })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useApp();
  const location = useLocation();
  if (!state.signedIn) return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

const auth = (el: ReactNode) => <RequireAuth>{el}</RequireAuth>;

/** Root: the live engine, toasts and lazy-loaded screens. */
function Root() {
  return (
    <>
      <LiveEngine />
      <Suspense fallback={<div className="empty">Loading…</div>}>
        <Outlet />
      </Suspense>
      <Toasts />
    </>
  );
}

// A data router, so screens with unsaved drafts can warn before you leave (useBlocker).
const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/sign-in', element: <SignInPage /> },
      // Public pages linked from sign-in.
      { path: '/status', element: <StatusPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/support', element: <SupportPage /> },
      // The phone page is opened from a WhatsApp/SMS link with a one-time token (PH-01).
      { path: '/m/alarm/:id', element: <PhoneAlertPage /> },
      { path: '/wheelhouse', element: auth(<WheelhousePage />) },
      // "Open on a second screen" from the video wall: the wall without the console around it.
      { path: '/wall', element: auth(<VideoWallPopoutPage />) },
      {
        element: auth(<AppShell />),
        children: [
          { index: true, element: <OperationsCenterPage /> },
          { path: 'video-wall', element: <VideoWallPage /> },
          { path: 'alarms', element: <AlarmConsolePage /> },
          { path: 'alarms/:id', element: <AlarmConsolePage /> },
          { path: 'voyages', element: <VoyagesPage /> },
          { path: 'voyages/:id', element: <VoyageRecordPage /> },
          { path: 'config/use-cases', element: <UseCasesPage /> },
          { path: 'config/use-cases/:id', element: <UseCasesPage /> },
          { path: 'config/cameras', element: <CamerasPage /> },
          { path: 'config/routing', element: <AlertRoutingPage /> },
          { path: 'config/edge-units', element: <EdgeUnitsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'reports/daily', element: <DailySummaryPage /> },
          { path: 'insights/models', element: <ModelPerformancePage /> },
          { path: 'admin/users', element: <UsersPage /> },
          { path: 'admin/audit', element: <AuditLogPage /> },
          { path: 'admin/integrations', element: <IntegrationsPage /> },
          { path: 'admin/plan', element: <PlanPage /> },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
    ],
  },
]);

export function App() {
  return (
    <AppStateProvider>
      <RouterProvider router={router} />
    </AppStateProvider>
  );
}
