import { lazy, Suspense, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { LayoutConfig, RendererAPI } from './renderers/core/types';
import { useAdminSession } from './hooks/useAdminSession';
import { getPreferredAdminHome } from './utils/adminAuth';

const AppLayout = lazy(() => import('./components/Layout/AppLayout').then((mod) => ({ default: mod.AppLayout })));
const DocChatPanel = lazy(() => import('./components/ChatPanel/DocChatPanel').then((mod) => ({ default: mod.DocChatPanel })));
const MainWorkspace = lazy(() => import('./components/Workspace/MainWorkspace').then((mod) => ({ default: mod.MainWorkspace })));
const RightPanel = lazy(() => import('./components/Layout/RightPanel').then((mod) => ({ default: mod.RightPanel })));
const ExportDialog = lazy(() => import('./components/ExportDialog/ExportDialog').then((mod) => ({ default: mod.ExportDialog })));

const LoginPage = lazy(() => import('./pages/Admin/LoginPage'));
const RegisterPage = lazy(() => import('./pages/Admin/RegisterPage'));
const TestPage = lazy(() => import('./pages/Admin/TestPage'));
const DashboardPage = lazy(() => import('./pages/Admin/DashboardPage'));
const ConfigPage = lazy(() => import('./pages/Admin/ConfigPage'));
const MonitorPage = lazy(() => import('./pages/Admin/MonitorPage'));
const LogsPage = lazy(() => import('./pages/Admin/LogsPage'));
const AnalyticsPage = lazy(() => import('./pages/Admin/AnalyticsPage'));
const ProfilePage = lazy(() => import('./pages/Admin/ProfilePage'));
const RbacPage = lazy(() => import('./pages/Admin/RbacPage'));
const UsersPage = lazy(() => import('./pages/Admin/UsersPage'));
const JobsPage = lazy(() => import('./pages/Admin/JobsPage'));
const QATracesPage = lazy(() => import('./pages/Admin/QATracesPage'));

const RouteLoading = () => (
  <div
    style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
      color: '#334155',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      letterSpacing: '0.02em',
    }}
  >
    Loading GraphInsight...
  </div>
);

function MainApp() {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const rendererRef = useRef<RendererAPI | null>(null);

  const handleLayoutChange = (layout: string, config?: LayoutConfig) => {
    rendererRef.current?.applyLayout(layout, config);
    setTimeout(() => {
      rendererRef.current?.fitTo(undefined, 50);
    }, 120);
  };

  const handleGroupingChange = () => {
    if (rendererRef.current) {
      setTimeout(() => {
        rendererRef.current?.fitTo(undefined, 50);
      }, 100);
    }
  };

  return (
    <>
      <AppLayout
        queryPanel={<DocChatPanel />}
        graphCanvas={<MainWorkspace rendererRef={rendererRef} onGroupingUpdate={handleGroupingChange} />}
        detailPanel={
          <RightPanel
            rendererRef={rendererRef}
            onLayoutChange={handleLayoutChange}
            onGroupingChange={handleGroupingChange}
          />
        }
        onExportClick={() => setExportDialogOpen(true)}
      />
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        rendererRef={rendererRef}
      />
    </>
  );
}

function SessionLoading() {
  return <RouteLoading />;
}

type AdminSessionSnapshot = {
  isChecking: boolean;
  isAuthenticated: boolean;
};

function RequireAdminAuth({ children, session }: { children: ReactNode; session: AdminSessionSnapshot }) {
  const { isChecking, isAuthenticated } = session;
  if (isChecking) {
    return <SessionLoading />;
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/admin/login" replace />;
}

function PublicAuthOnly({ children, session }: { children: ReactNode; session: AdminSessionSnapshot }) {
  const { isChecking, isAuthenticated } = session;
  if (isChecking) {
    return <SessionLoading />;
  }
  return isAuthenticated ? <Navigate to={getPreferredAdminHome()} replace /> : <>{children}</>;
}

function HomeRedirect({ session }: { session: AdminSessionSnapshot }) {
  const { isChecking, isAuthenticated } = session;
  if (isChecking) {
    return <SessionLoading />;
  }
  return <Navigate to={isAuthenticated ? getPreferredAdminHome() : '/admin/login'} replace />;
}

function App() {
  const { isChecking, isAuthenticated } = useAdminSession();
  const session = { isChecking, isAuthenticated };

  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<HomeRedirect session={session} />} />
        <Route path="/login" element={<Navigate to="/admin/login" replace />} />
        <Route path="/register" element={<Navigate to="/admin/register" replace />} />
        <Route path="/admin" element={<HomeRedirect session={session} />} />
        <Route
          path="/admin/login"
          element={
            <PublicAuthOnly session={session}>
              <LoginPage />
            </PublicAuthOnly>
          }
        />
        <Route
          path="/admin/register"
          element={
            <PublicAuthOnly session={session}>
              <RegisterPage />
            </PublicAuthOnly>
          }
        />
        <Route
          path="/workspace"
          element={
            <RequireAdminAuth session={session}>
              <MainApp />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/test"
          element={
            <RequireAdminAuth session={session}>
              <TestPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/dashboard"
          element={
            <RequireAdminAuth session={session}>
              <DashboardPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/config"
          element={
            <RequireAdminAuth session={session}>
              <ConfigPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/monitor"
          element={
            <RequireAdminAuth session={session}>
              <MonitorPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/logs"
          element={
            <RequireAdminAuth session={session}>
              <LogsPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <RequireAdminAuth session={session}>
              <AnalyticsPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/profile"
          element={
            <RequireAdminAuth session={session}>
              <ProfilePage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/rbac"
          element={
            <RequireAdminAuth session={session}>
              <RbacPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAdminAuth session={session}>
              <UsersPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/jobs"
          element={
            <RequireAdminAuth session={session}>
              <JobsPage />
            </RequireAdminAuth>
          }
        />
        <Route
          path="/admin/qa-traces"
          element={
            <RequireAdminAuth session={session}>
              <QATracesPage />
            </RequireAdminAuth>
          }
        />
        <Route path="*" element={<HomeRedirect session={session} />} />
      </Routes>
    </Suspense>
  );
}

export default App;
