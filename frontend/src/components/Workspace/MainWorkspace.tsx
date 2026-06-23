import { lazy, Suspense, useEffect } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { Article as ArticleIcon, Hub as HubIcon } from '@mui/icons-material';
import { DocumentPanel } from './DocumentPanel';
import { useGraphStore } from '../../store/graphStore';
import type { GraphData } from '../../store/graphStore';
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
  const graphData = useGraphStore((state) => state.graphData);
  const setGraphData = useGraphStore((state) => state.setGraphData);
  const setSelectedNodeId = useGraphStore((state) => state.setSelectedNodeId);

  useEffect(() => {
    if (!import.meta.env.DEV || graphData) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('graph_demo') !== '1') return;

    const nodes: GraphData['nodes'] = [];
    const edges: GraphData['edges'] = [];
    const addNode = (id: string, label: string, labels: string[], extra: Record<string, unknown> = {}) => {
      nodes.push({ id, labels, properties: { name: label, title: label, ...extra } });
    };
    const addEdge = (id: string, source: string, target: string, type: string) => {
      edges.push({ id, source, target, type, properties: { relation: type } });
    };

    addNode('doc-wheat-rust', '小麦条锈病防治报告', ['Document'], { filename: '5种药剂对小麦条锈病的防效.pdf' });
    for (let index = 1; index <= 6; index += 1) {
      addNode(`chunk-${index}`, `试验片段 ${index}`, ['Chunk']);
      addEdge(`doc-chunk-${index}`, 'doc-wheat-rust', `chunk-${index}`, 'HAS_CHUNK');
    }
    for (let index = 1; index <= 30; index += 1) {
      addNode(`entity-${index}`, `农业实体 ${index}`, ['Entity']);
      addEdge(`chunk-entity-${index}`, `chunk-${(index % 6) + 1}`, `entity-${index}`, 'MENTIONS');
    }
    for (let index = 1; index <= 8; index += 1) {
      addNode(`fact-${index}`, `防效事实 ${index}`, ['Fact']);
      addEdge(`fact-source-${index}`, `fact-${index}`, `chunk-${(index % 6) + 1}`, 'SUPPORTED_BY');
      addEdge(`fact-entity-${index}`, `fact-${index}`, `entity-${((index * 3) % 30) + 1}`, 'ABOUT');
    }

    setGraphData({
      nodes,
      edges,
      stats: { nodeCount: nodes.length, edgeCount: edges.length, executionTime: 0.032 },
    });
    setSelectedNodeId(null);
    setWorkspaceTab('graph');
  }, [graphData, setGraphData, setSelectedNodeId, setWorkspaceTab]);

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
