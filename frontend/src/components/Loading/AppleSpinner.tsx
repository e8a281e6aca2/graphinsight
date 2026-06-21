import { Box, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import '../../styles/loading.css';

type AppleSpinnerProps = {
  size?: number;
  label?: string;
  compact?: boolean;
  color?: string;
};

type LoadingStateProps = AppleSpinnerProps & {
  minHeight?: number | string;
  sx?: SxProps<Theme>;
};

const SEGMENTS = Array.from({ length: 12 }, (_, index) => index);

export function AppleSpinner({ size = 44, label, compact = false, color }: AppleSpinnerProps) {
  const segmentWidth = Math.max(4, Math.round(size * 0.12));
  const segmentHeight = Math.max(10, Math.round(size * 0.32));
  const radius = Math.round(size * 0.36);

  return (
    <Box className="apple-spinner-wrap" sx={{ gap: compact ? 0 : 1.25, color: color || (compact ? 'currentColor' : 'text.secondary') }}>
      <Box
        className="apple-spinner"
        role="status"
        aria-label={label || '正在加载'}
        sx={{
          width: size,
          height: size,
        }}
      >
        {SEGMENTS.map((item) => (
          <Box
            key={item}
            className="apple-spinner-segment"
            sx={{
              width: segmentWidth,
              height: segmentHeight,
              borderRadius: segmentWidth,
              transform: `translate(-50%, -50%) rotate(${item * 30}deg) translateY(-${radius}px)`,
              animationDelay: `${item * -0.08}s`,
            }}
          />
        ))}
      </Box>
      {label && !compact ? (
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      ) : null}
    </Box>
  );
}

export function LoadingState({ label, size = 44, minHeight = 320, sx }: LoadingStateProps) {
  return (
    <Box
      sx={{
        minHeight,
        flex: 1,
        width: '100%',
        minWidth: 0,
        display: 'grid',
        placeItems: 'center',
        px: 3,
        py: 5,
        ...sx,
      }}
    >
      <AppleSpinner size={size} label={label} />
    </Box>
  );
}
