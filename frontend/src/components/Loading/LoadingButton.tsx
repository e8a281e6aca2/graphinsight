import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import type { ButtonProps } from '@mui/material/Button';
import { AppleSpinner } from './AppleSpinner';

type LoadingButtonProps = Omit<ButtonProps, 'children' | 'startIcon'> & {
  loading?: boolean;
  label: ReactNode;
  loadingLabel?: ReactNode;
  startIcon?: ReactNode;
};

export default function LoadingButton({
  loading = false,
  label,
  loadingLabel,
  startIcon,
  disabled,
  ...buttonProps
}: LoadingButtonProps) {
  return (
    <Button
      {...buttonProps}
      startIcon={loading ? <AppleSpinner size={18} compact /> : startIcon}
      disabled={disabled || loading}
    >
      {loading ? loadingLabel || label : label}
    </Button>
  );
}
