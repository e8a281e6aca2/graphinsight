import React from 'react';
import type { ReactNode } from 'react';
import { Box, CssBaseline, ThemeProvider, Typography } from '@mui/material';
import { adminTheme } from '../../theme/adminTheme';
import '../../styles/adminTheme.css';

type AdminAuthLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

const AdminAuthLayout: React.FC<AdminAuthLayoutProps> = ({ title, subtitle, children }) => {
  return (
    <ThemeProvider theme={adminTheme}>
      <CssBaseline />
      <Box className="admin-root" sx={{ minHeight: '100vh', position: 'relative' }}>
        <Box className="admin-orb" sx={{ top: 60, left: 120 }} />
        <Box className="admin-orb secondary" sx={{ bottom: 80, right: 80 }} />
        <Box
          sx={{
            minHeight: '100vh',
            display: 'grid',
            placeItems: 'center',
            px: 2,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box sx={{ width: '100%', maxWidth: { xs: 460, md: 760 } }}>
            <Typography
              variant="h3"
              sx={{
                mb: 1,
                whiteSpace: 'nowrap',
                fontSize: { xs: '2.25rem', sm: '3rem', md: '4rem' },
                lineHeight: 1.08,
              }}
            >
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
                {subtitle}
              </Typography>
            )}
            {children}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};

export default AdminAuthLayout;
