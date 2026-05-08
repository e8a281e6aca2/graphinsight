import React, { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box,
  CssBaseline,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
} from '@mui/material';
import {
  Analytics,
  Dashboard,
  Description,
  FactCheck,
  Gavel,
  ManageSearch,
  MonitorHeart,
  Person,
  Settings,
  Shield,
  WorkHistory,
  Menu as MenuIcon,
} from '@mui/icons-material';
import { ThemeProvider } from '@mui/material/styles';
import { useLocation, useNavigate } from 'react-router-dom';
import { adminTheme } from '../../theme/adminTheme';
import '../../styles/adminTheme.css';

type AdminLayoutProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
};

const drawerWidth = 260;

const AdminLayout: React.FC<AdminLayoutProps> = ({ title, subtitle, actions, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(adminTheme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = useMemo(
    () => [
      { label: '仪表盘', icon: <Dashboard />, path: '/admin/dashboard' },
      { label: '配置中心', icon: <Settings />, path: '/admin/config' },
      { label: '系统监控', icon: <MonitorHeart />, path: '/admin/monitor' },
      { label: '日志审计', icon: <FactCheck />, path: '/admin/logs' },
      { label: '数据分析', icon: <Analytics />, path: '/admin/analytics' },
      { label: '权限管理', icon: <Shield />, path: '/admin/rbac' },
      { label: '用户管理', icon: <Person />, path: '/admin/users' },
      { label: '任务中心', icon: <WorkHistory />, path: '/admin/jobs' },
      { label: '问答追踪', icon: <ManageSearch />, path: '/admin/qa-traces' },
    ],
    []
  );

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const drawer = (
    <Stack sx={{ height: '100%', px: 2, py: 3 }}>
      <Stack spacing={0.5} sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          GraphInsight
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Enterprise Admin
        </Typography>
      </Stack>

      <List sx={{ flex: 1 }}>
        {navItems.map((item) => {
          const selected = location.pathname.startsWith(item.path);
          return (
            <ListItemButton
              key={item.path}
              selected={selected}
              onClick={() => handleNavigate(item.path)}
              sx={{
                borderRadius: 2,
                mb: 1,
                '&.Mui-selected': {
                  backgroundColor: 'rgba(27, 127, 121, 0.12)',
                },
                '&.Mui-selected:hover': {
                  backgroundColor: 'rgba(27, 127, 121, 0.18)',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: selected ? 'primary.main' : 'text.secondary' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>

      <Stack spacing={1} sx={{ mt: 2 }}>
        <ListItemButton
          onClick={() => handleNavigate('/admin/profile')}
          sx={{ borderRadius: 2, backgroundColor: 'rgba(15, 31, 45, 0.04)' }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <Gavel />
          </ListItemIcon>
          <ListItemText primary="个人设置" secondary="账号与安全" />
        </ListItemButton>
        <ListItemButton
          onClick={() => handleNavigate('/')}
          sx={{ borderRadius: 2, backgroundColor: 'rgba(15, 31, 45, 0.04)' }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <Description />
          </ListItemIcon>
          <ListItemText primary="返回工作台" secondary="图谱主界面" />
        </ListItemButton>
      </Stack>
    </Stack>
  );

  return (
    <ThemeProvider theme={adminTheme}>
      <CssBaseline />
      <Box className="admin-root" sx={{ minHeight: '100vh', position: 'relative' }}>
        <Box className="admin-orb" sx={{ top: 40, left: 180 }} />
        <Box className="admin-orb secondary" sx={{ top: 140, right: 120 }} />
        <Box sx={{ display: 'flex', position: 'relative', zIndex: 1 }}>
          <Drawer
            variant={isMobile ? 'temporary' : 'permanent'}
            open={isMobile ? mobileOpen : true}
            onClose={() => setMobileOpen(false)}
            sx={{
              width: drawerWidth,
              flexShrink: 0,
              '& .MuiDrawer-paper': {
                width: drawerWidth,
                boxSizing: 'border-box',
                backgroundColor: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(10px)',
                borderRight: '1px solid rgba(15, 31, 45, 0.08)',
              },
            }}
          >
            <Toolbar sx={{ minHeight: 24 }} />
            {drawer}
          </Drawer>

          <Box sx={{ flexGrow: 1, px: { xs: 2, md: 5 }, py: 4 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 4 }}>
              {isMobile && (
                <IconButton onClick={() => setMobileOpen(true)}>
                  <MenuIcon />
                </IconButton>
              )}
              <Box sx={{ flex: 1 }}>
                <Typography variant="h4">{title}</Typography>
                {subtitle && (
                  <Typography variant="body2" color="text.secondary">
                    {subtitle}
                  </Typography>
                )}
              </Box>
              {actions}
            </Stack>
            {children}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default AdminLayout;
