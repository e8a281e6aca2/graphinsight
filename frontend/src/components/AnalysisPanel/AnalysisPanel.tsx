import { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  Route as RouteIcon,
} from '@mui/icons-material';
import { NodeImportancePanel } from './NodeImportancePanel';
import { PathAnalysisPanel } from './PathAnalysisPanel';
import type { Core } from 'cytoscape';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`analysis-tabpanel-${index}`}
      aria-labelledby={`analysis-tab-${index}`}
      style={{ height: '100%', overflow: 'auto' }}
      {...other}
    >
      {value === index && children}
    </div>
  );
}

interface AnalysisPanelProps {
  cyRef: React.RefObject<Core | null>;
}

export function AnalysisPanel({ cyRef }: AnalysisPanelProps) {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 子标签页 */}
      <Tabs
        value={tabValue}
        onChange={handleTabChange}
        variant="fullWidth"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 40,
          '& .MuiTab-root': {
            minHeight: 40,
            fontSize: '0.8rem',
          },
        }}
      >
        <Tab
          icon={<TrendingUpIcon sx={{ fontSize: 16 }} />}
          label="重要性"
          iconPosition="start"
        />
        <Tab
          icon={<RouteIcon sx={{ fontSize: 16 }} />}
          label="路径"
          iconPosition="start"
        />
      </Tabs>

      {/* 标签页内容 */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <TabPanel value={tabValue} index={0}>
          <NodeImportancePanel cyRef={cyRef} />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <PathAnalysisPanel cyRef={cyRef} />
        </TabPanel>
      </Box>
    </Box>
  );
}
