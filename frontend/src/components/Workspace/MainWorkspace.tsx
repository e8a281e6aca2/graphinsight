import { lazy, Suspense } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { Article as ArticleIcon, Hub as HubIcon } from '@mui/icons-material';
import { DocumentPanel } from './DocumentPanel';
import { useGraphStore } from '../../store/graphStore';
import type { RendererAPI } from '../../renderers/core/types';
import { LoadingState } from '../Loading/AppleSpinner';

const GraphCanvas = lazy(() => import('../GraphCanvas/GraphCanvas').then((mod) => ({ default: mod.GraphCanvas })));

const WorkspaceLoading = ({ label }: { label: string }) => (
  <LoadingState label={label} minHeight="100%" sx={{ bgcolor: 'background.default' }} />
);

interface MainWorkspaceProps {
  rendererRef: React.RefObject<RendererAPI | null>;
  onGroupingUpdate?: () => void;
}

export function MainWorkspace({ rendererRef, onGroupingUpdate }: MainWorkspaceProps) {
  const activeTab = useGraphStore((state) => state.activeWorkspaceTab);
  const setWorkspaceTab = useGraphStore((state) => state.setWorkspaceTab);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      <Box
        sx={{
          px: 2,
          pt: 1.5,
          pb: 0.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(_, value) => setWorkspaceTab(value as 'document' | 'graph')}
          textColor="primary"
          indicatorColor="primary"
        >
          <Tab
            value="document"
            icon={<ArticleIcon sx={{ fontSize: 18 }} />}
            label="引用证据"
            iconPosition="start"
          />
          <Tab
            value="graph"
            icon={<HubIcon sx={{ fontSize: 18 }} />}
            label="关系图谱"
            iconPosition="start"
          />
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: activeTab === 'document' ? 1 : 0,
            pointerEvents: activeTab === 'document' ? 'auto' : 'none',
            zIndex: activeTab === 'document' ? 2 : 1,
            transition: 'opacity 0.2s ease',
          }}
        >
          <DocumentPanel />
        </Box>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: activeTab === 'graph' ? 1 : 0,
            pointerEvents: activeTab === 'graph' ? 'auto' : 'none',
            zIndex: activeTab === 'graph' ? 2 : 1,
            transition: 'opacity 0.2s ease',
          }}
        >
          {activeTab === 'graph' && (
            <Suspense fallback={<WorkspaceLoading label="正在加载关系图谱" />}>
              <GraphCanvas rendererRef={rendererRef} onGroupingUpdate={onGroupingUpdate} />
            </Suspense>
          )}
        </Box>
      </Box>
    </Box>
  );
}
