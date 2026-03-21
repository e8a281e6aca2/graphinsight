const resolveEnvBase = () => {
  const envValue = (import.meta as any)?.env?.VITE_API_BASE_URL;
  if (typeof envValue !== 'string') {
    return '';
  }
  return envValue.trim();
};

const normalizeBase = (value: string) => value.replace(/\/+$/, '');

const resolveRuntimeOrigin = () => {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.location?.origin || '';
};

const envBase = resolveEnvBase();
const runtimeOrigin = resolveRuntimeOrigin();

const envIsAuto = !envBase || envBase === 'auto' || envBase === 'same-origin';

const normalizedEnv = envIsAuto ? '' : normalizeBase(envBase);
const cleanedEnv = normalizedEnv.endsWith('/api') ? normalizedEnv.slice(0, -4) : normalizedEnv;
const resolvedBase = cleanedEnv || runtimeOrigin || 'http://localhost:8000';

export const API_BASE_URL = normalizeBase(resolvedBase);

export const API_ROOT_URL = API_BASE_URL.endsWith('/api') ? API_BASE_URL : `${API_BASE_URL}/api`;

export function buildApiUrl(path: string, useApiRoot = true) {
  const base = useApiRoot ? API_ROOT_URL : API_BASE_URL;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function buildProxyMediaUrl(url: string) {
  return `${API_ROOT_URL}/proxy-media?url=${encodeURIComponent(url)}`;
}
