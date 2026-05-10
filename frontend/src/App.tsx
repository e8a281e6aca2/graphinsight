import { lazy, Suspense, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import type { RendererAPI } from './renderers/core/types';

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

  const handleLayoutChange = (layout: string, config?: any) => {
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

function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/" element={<MainApp />} />
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin/register" element={<RegisterPage />} />
        <Route path="/admin/test" element={<TestPage />} />
        <Route path="/admin/dashboard" element={<DashboardPage />} />
        <Route path="/admin/config" element={<ConfigPage />} />
        <Route path="/admin/monitor" element={<MonitorPage />} />
        <Route path="/admin/logs" element={<LogsPage />} />
        <Route path="/admin/analytics" element={<AnalyticsPage />} />
        <Route path="/admin/profile" element={<ProfilePage />} />
        <Route path="/admin/rbac" element={<RbacPage />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/jobs" element={<JobsPage />} />
        <Route path="/admin/qa-traces" element={<QATracesPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
