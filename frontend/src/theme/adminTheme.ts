import { createTheme } from '@mui/material/styles';

export const adminTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1b7f79',
      dark: '#145c58',
      light: '#3aa49e',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#f2b705',
      dark: '#c59100',
      light: '#ffd35a',
      contrastText: '#1f1f1f',
    },
    background: {
      default: '#f2f6f7',
      paper: '#ffffff',
    },
    text: {
      primary: '#0f1f2d',
      secondary: '#5f7186',
    },
  },
  typography: {
    fontFamily: '"Work Sans", "Segoe UI", sans-serif',
    h1: {
      fontFamily: '"Space Grotesk", "Work Sans", sans-serif',
      fontWeight: 700,
    },
    h2: {
      fontFamily: '"Space Grotesk", "Work Sans", sans-serif',
      fontWeight: 700,
    },
    h3: {
      fontFamily: '"Space Grotesk", "Work Sans", sans-serif',
      fontWeight: 600,
    },
    h4: {
      fontFamily: '"Space Grotesk", "Work Sans", sans-serif',
      fontWeight: 600,
    },
    h5: {
      fontFamily: '"Space Grotesk", "Work Sans", sans-serif',
      fontWeight: 600,
    },
    h6: {
      fontFamily: '"Space Grotesk", "Work Sans", sans-serif',
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          border: '1px solid rgba(15, 31, 45, 0.08)',
          boxShadow: '0 12px 40px rgba(15, 31, 45, 0.08)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 18,
          border: '1px solid rgba(15, 31, 45, 0.08)',
          boxShadow: '0 16px 40px rgba(15, 31, 45, 0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 12,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(15, 31, 45, 0.04)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          color: '#0f1f2d',
        },
      },
    },
  },
});
