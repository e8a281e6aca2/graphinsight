import { useState, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import type { Core } from 'cytoscape';
import { AppLayout } from './components/Layout/AppLayout';
import { QueryPanel } from './components/QueryPanel/QueryPanel';
import { GraphCanvas } from './components/GraphCanvas/GraphCanvas';
import { RightPanel } from './components/Layout/RightPanel';
import { ExportDialog } from './components/ExportDialog/ExportDialog';
import { LAYOUT_CONFIGS } from './utils/cytoscapeConfig';

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
  const cyRef = useRef<Core | null>(null);

  const handleLayoutChange = (layout: string, config?: any) => {
    if (cyRef.current) {
      const layoutConfig = config || LAYOUT_CONFIGS[layout as keyof typeof LAYOUT_CONFIGS];
      const layoutInstance = cyRef.current.layout(layoutConfig);
      layoutInstance.run();
    }
  };

  const handleGroupingChange = () => {
    // 分组变化时，重新运行布局以适应新的分组结构
    if (cyRef.current) {
      setTimeout(() => {
        const layoutInstance = cyRef.current!.layout(LAYOUT_CONFIGS.cose);
        layoutInstance.run();
      }, 100);
    }
  };

  return (
    <>
      <AppLayout
        queryPanel={
          <QueryPanel 
            onLayoutChange={handleLayoutChange} 
            onGroupingChange={handleGroupingChange}
            cyRef={cyRef}
          />
        }
        graphCanvas={
          <GraphCanvas 
            cyRef={cyRef} 
            onGroupingUpdate={handleGroupingChange}
          />
        }
        detailPanel={<RightPanel cyRef={cyRef} />}
        onExportClick={() => setExportDialogOpen(true)}
      />
      <ExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        cyRef={cyRef}
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
