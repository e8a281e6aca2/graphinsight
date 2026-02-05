import { AppBar, Toolbar, Typography, IconButton, Box, Tooltip } from '@mui/material';
import {
  Brightness4 as DarkModeIcon,
  Brightness7 as LightModeIcon,
  FileDownload as ExportIcon,
  Help as HelpIcon,
} from '@mui/icons-material';
import { useGraphStore } from '../../store/graphStore';
import logoSvg from '../../assets/images/logo.svg';

interface TopBarProps {
  onExportClick?: () => void;
}

export function TopBar({ onExportClick }: TopBarProps) {
  const isDarkMode = useGraphStore((state) => state.isDarkMode);
  const toggleTheme = useGraphStore((state) => state.toggleTheme);

  return (
    <AppBar position="static" elevation={1}>
      <Toolbar>
        {/* Logo 和标题 */}
        <Box sx={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
          <img 
            src={logoSvg} 
            alt="GraphInsight Logo" 
            style={{ height: 32, marginRight: 8 }}
          />
          <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
            GraphInsight
          </Typography>
          <Typography
            variant="body2"
            sx={{ 
              ml: 1, 
              opacity: 0.8, 
              display: { xs: 'none', md: 'block' },
              fontSize: '0.875rem',
              fontWeight: 400
            }}
          >
            农业多模态知识图谱可视化分析系统
          </Typography>
        </Box>

        {/* 操作按钮 */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="导出">
            <IconButton color="inherit" size="large" onClick={onExportClick}>
              <ExportIcon />
            </IconButton>
          </Tooltip>

          <Tooltip title={isDarkMode ? '切换到浅色模式' : '切换到深色模式'}>
            <IconButton color="inherit" onClick={toggleTheme} size="large">
              {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>

          <Tooltip title="帮助">
            <IconButton color="inherit" size="large">
              <HelpIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
