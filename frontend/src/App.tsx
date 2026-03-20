import { useState, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/Layout/AppLayout';
import { DocChatPanel } from './components/ChatPanel/DocChatPanel';
import { MainWorkspace } from './components/Workspace/MainWorkspace';
import { RightPanel } from './components/Layout/RightPanel';
import { ExportDialog } from './components/ExportDialog/ExportDialog';
import type { RendererAPI } from './renderers/core/types';

// 管理系统页面
import LoginPage from './pages/Admin/LoginPage';
import RegisterPage from './pages/Admin/RegisterPage';
import TestPage from './pages/Admin/TestPage';
import DashboardPage from './pages/Admin/DashboardPage';
import ConfigPage from './pages/Admin/ConfigPage';
import MonitorPage from './pages/Admin/MonitorPage';
import LogsPage from './pages/Admin/LogsPage';
import AnalyticsPage from './pages/Admin/AnalyticsPage';
import ProfilePage from './pages/Admin/ProfilePage';

function MainApp() {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const rendererRef = useRef<RendererAPI | null>(null);

  const handleLayoutChange = () => {
    rendererRef.current?.fitTo(undefined, 50);
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
    <Routes>
      {/* 主应用 */}
      <Route path="/" element={<MainApp />} />

      {/* 管理系统 */}
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin/register" element={<RegisterPage />} />
      <Route path="/admin/test" element={<TestPage />} />
      <Route path="/admin/dashboard" element={<DashboardPage />} />
      <Route path="/admin/config" element={<ConfigPage />} />
      <Route path="/admin/monitor" element={<MonitorPage />} />
      <Route path="/admin/logs" element={<LogsPage />} />
      <Route path="/admin/analytics" element={<AnalyticsPage />} />
      <Route path="/admin/profile" element={<ProfilePage />} />
    </Routes>
  );
}

export default App;
