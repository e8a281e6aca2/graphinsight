import { Box, Typography, Divider, Tabs, Tab } from '@mui/material';
import { useState, useRef } from 'react';
import type { Core } from 'cytoscape';
import { CypherEditor } from './CypherEditor';
import { QueryHistory } from './QueryHistory';
import { QueryStats } from './QueryStats';
import { LayoutPanel } from './LayoutPanel';
import { GroupingPanel } from './GroupingPanel';
import { FilterPanel } from '../FilterPanel/FilterPanel';
import { ToolBar } from './ToolBar';
import { NL2CypherInput } from './NL2CypherInput';

interface QueryPanelProps {
  onLayoutChange?: (layout: string, config?: any) => void;
  onGroupingChange?: () => void;
  cyRef?: React.RefObject<Core | null>;
}

export function QueryPanel({ onLayoutChange, onGroupingChange, cyRef }: QueryPanelProps) {
  const [activeTab, setActiveTab] = useState(0);
  const cypherEditorRef = useRef<any>(null);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* 标题和标签页 */}
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

      {/* 主内容区域 - 可滚动 */}
      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          minHeight: 0, // 确保flex子元素可以收缩
        }}
      >
        {/* 查询标签页 */}
        {activeTab === 0 && (
          <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* AI 查询助手 */}
            <NL2CypherInput
              onCypherGenerated={(cypher) => {
                // 将生成的 Cypher 填充到编辑器
                console.log('[QueryPanel] AI 生成的 Cypher:', cypher);
                if (cypherEditorRef.current) {
                  cypherEditorRef.current.setValue(cypher);
                }
              }}
              onExecute={(cypher) => {
                // 执行查询
                console.log('[QueryPanel] 执行 Cypher:', cypher);
                if (cypherEditorRef.current) {
                  cypherEditorRef.current.setValue(cypher);
                  cypherEditorRef.current.executeQuery();
                }
              }}
            />

            {/* Cypher 编辑器 */}
            <Box>
              <CypherEditor ref={cypherEditorRef} />
            </Box>

            {/* 查询统计 */}
            <QueryStats />

            {/* 查询历史 */}
            <QueryHistory />
          </Box>
        )}

        {/* 过滤标签页 */}
        {activeTab === 1 && <FilterPanel />}

        {/* 布局标签页 */}
        {activeTab === 2 && (
          <LayoutPanel 
            onLayoutChange={onLayoutChange || (() => {})} 
          />
        )}

        {/* 分组标签页 */}
        {activeTab === 3 && (
          <GroupingPanel 
            onGroupingChange={onGroupingChange || (() => {})} 
          />
        )}
      </Box>

      {/* 底部工具栏 */}
      {cyRef && <ToolBar cyRef={cyRef} />}
    </Box>
  );
}
