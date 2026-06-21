import { Box, Typography, Divider, Tabs, Tab } from '@mui/material';
import { useState, useRef, useEffect } from 'react';
import { CypherEditor, type CypherEditorRef } from './CypherEditor';
import { QueryHistory } from './QueryHistory';
import { QueryStats } from './QueryStats';
import { LayoutPanel } from './LayoutPanel';
import { GroupingPanel } from './GroupingPanel';
import { FilterPanel } from '../FilterPanel/FilterPanel';
import { ToolBar } from './ToolBar';
import type { LayoutConfig, RendererAPI } from '../../renderers/core/types';

interface QueryPanelProps {
  onLayoutChange?: (layout: string, config?: LayoutConfig) => void;
  onGroupingChange?: () => void;
  rendererRef?: React.RefObject<RendererAPI | null>;
  defaultTab?: number;
}

export function QueryPanel({ onLayoutChange, onGroupingChange, rendererRef, defaultTab = 0 }: QueryPanelProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const cypherEditorRef = useRef<CypherEditorRef | null>(null);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ p: 2, pb: 0 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          控制面板
        </Typography>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
          <Tab label="查询" />
          <Tab label="过滤" />
          <Tab label="布局" />
          <Tab label="分组" />
        </Tabs>
      </Box>

      <Divider />

      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0,
        }}
      >
        {activeTab === 0 && (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <CypherEditor ref={cypherEditorRef} />
            </Box>

            <QueryStats />

            <QueryHistory />
          </Box>
        )}

        {activeTab === 1 && <FilterPanel />}

        {activeTab === 2 && (
          <LayoutPanel onLayoutChange={onLayoutChange || (() => {})} />
        )}

        {activeTab === 3 && (
          <GroupingPanel onGroupingChange={onGroupingChange || (() => {})} />
        )}
      </Box>

      {rendererRef && <ToolBar rendererRef={rendererRef} />}
    </Box>
  );
}
