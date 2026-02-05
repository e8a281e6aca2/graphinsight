import React, { useState } from 'react';
import { Box, Tabs, Tab, Paper, Typography } from '@mui/material';
import { 
  Info as InfoIcon,
  Analytics as AnalyticsIcon,
  Science as ScienceIcon
} from '@mui/icons-material';
import { DetailPanel } from '../DetailPanel/DetailPanel';
import { GraphStatsPanel } from '../StatsPanel/GraphStatsPanel';
import { AnalysisPanel } from '../AnalysisPanel/AnalysisPanel';

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
      id={`right-panel-tabpanel-${index}`}
      aria-labelledby={`right-panel-tab-${index}`}
      style={{ height: '100%', overflow: 'hidden' }}
      {...other}
    >
      {value === index && (
        <Box sx={{ height: '100%', overflow: 'hidden' }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `right-panel-tab-${index}`,
    'aria-controls': `right-panel-tabpanel-${index}`,
  };
}

interface RightPanelProps {
  cyRef?: React.RefObject<any>;
}

export const RightPanel: React.FC<RightPanelProps> = ({ cyRef }) => {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Box sx={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* 标签页头部 */}
      <Paper 
        square 
        elevation={0}
        sx={{ 
          borderBottom: 1, 
          borderColor: 'divider',
          flexShrink: 0
        }}
      >
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          variant="fullWidth"
          sx={{
            minHeight: 48,
            '& .MuiTab-root': {
              minHeight: 48,
              fontSize: '0.75rem',
              fontWeight: 500,
            }
          }}
        >
          <Tab
            icon={<InfoIcon sx={{ fontSize: 18 }} />}
            label="详情"
            iconPosition="start"
            {...a11yProps(0)}
          />
          <Tab
            icon={<AnalyticsIcon sx={{ fontSize: 18 }} />}
            label="统计"
            iconPosition="start"
            {...a11yProps(1)}
          />
          <Tab
            icon={<ScienceIcon sx={{ fontSize: 18 }} />}
            label="分析"
            iconPosition="start"
            {...a11yProps(2)}
          />
        </Tabs>
      </Paper>

      {/* 标签页内容 */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <TabPanel value={tabValue} index={0}>
          <DetailPanel />
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <GraphStatsPanel />
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          {cyRef ? (
            <AnalysisPanel cyRef={cyRef} />
          ) : (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                图谱未加载
              </Typography>
            </Box>
          )}
        </TabPanel>
      </Box>
    </Box>
  );
};