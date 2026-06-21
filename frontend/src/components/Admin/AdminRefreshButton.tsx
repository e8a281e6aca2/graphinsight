import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import type { ButtonProps } from '@mui/material/Button';
import Refresh from '@mui/icons-material/Refresh';
import { AppleSpinner } from '../Loading/AppleSpinner';

type AdminRefreshButtonProps = Omit<ButtonProps, 'children' | 'startIcon'> & {
  loading?: boolean;
  label?: ReactNode;
  loadingLabel?: ReactNode;
};

export default function AdminRefreshButton({
  loading = false,
  label = '刷新',
  loadingLabel = '刷新中...',
  disabled,
  variant = 'outlined',
  ...buttonProps
}: AdminRefreshButtonProps) {
  return (
    <Button
      {...buttonProps}
      variant={variant}
      startIcon={loading ? <AppleSpinner size={18} compact /> : <Refresh fontSize="small" />}
      disabled={disabled || loading}
    >
      {loading ? loadingLabel : label}
    </Button>
  );
}
