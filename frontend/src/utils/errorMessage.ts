import axios from 'axios';

type ApiErrorPayload = {
  message?: unknown;
  trace_id?: unknown;
  error?: unknown;
};

function getPayloadMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const data = payload as ApiErrorPayload;
  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }
  if (data.error && typeof data.error === 'object' && 'message' in data.error) {
    const nested = (data.error as { message?: unknown }).message;
    if (typeof nested === 'string' && nested.trim()) {
      return nested.trim();
    }
  }
  return '';
}

export function getErrorMessage(reason: unknown, fallback: string): string {
  if (axios.isAxiosError<ApiErrorPayload>(reason)) {
    const status = reason.response?.status;
    if (status === 401) {
      return '未登录或登录已过期，请先登录后再操作。';
    }
    if (status === 403) {
      return '当前账号权限不足，无法执行该操作。';
    }
    const payloadMessage = getPayloadMessage(reason.response?.data);
    if (payloadMessage) {
      const traceId = reason.response?.data?.trace_id;
      return typeof traceId === 'string' && traceId
        ? `${payloadMessage} [trace_id: ${traceId}]`
        : payloadMessage;
    }
    if (typeof status === 'number') {
      return `${fallback}（HTTP ${status}）`;
    }
  }

  if (
    reason &&
    typeof reason === 'object' &&
    'message' in reason &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message;
  }

  if (typeof reason === 'string' && reason.trim()) {
    return reason;
  }

  return fallback;
}
