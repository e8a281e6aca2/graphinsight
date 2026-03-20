const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CLIENT_LOG_ENDPOINT = `${API_BASE_URL}/api/client-logs`;

export type ClientLogLevel = 'info' | 'warn' | 'error';

export interface ClientLogPayload {
  level: ClientLogLevel;
  message: string;
  context?: Record<string, any>;
  source?: string;
  event?: string;
}

export function reportClientLog(payload: ClientLogPayload) {
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([body], { type: 'application/json' });
      const ok = navigator.sendBeacon(CLIENT_LOG_ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    // ignore
  }

  fetch(CLIENT_LOG_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // ignore logging errors
  });
}
