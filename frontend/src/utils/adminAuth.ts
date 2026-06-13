const ADMIN_TOKEN_KEY = 'admin_token';
const ADMIN_HOME_KEY = 'admin_home_path';
const ADMIN_SESSION_EVENT = 'graphinsight:admin-session-change';

export type AdminHomePath = '/admin/dashboard' | '/workspace';

type AdminSessionChangeDetail = {
  authenticated: boolean;
};

function emitAdminSessionChange(detail: AdminSessionChangeDetail): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<AdminSessionChangeDetail>(ADMIN_SESSION_EVENT, { detail }));
}

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function hasAdminToken(): boolean {
  return Boolean(getAdminToken());
}

export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  emitAdminSessionChange({ authenticated: true });
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
  emitAdminSessionChange({ authenticated: false });
}

export function subscribeAdminSessionChange(listener: (authenticated: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<AdminSessionChangeDetail>;
    listener(Boolean(customEvent.detail?.authenticated));
  };

  window.addEventListener(ADMIN_SESSION_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(ADMIN_SESSION_EVENT, handler as EventListener);
  };
}

export function getPreferredAdminHome(): AdminHomePath {
  if (typeof window === 'undefined') {
    return '/admin/dashboard';
  }
  const value = window.localStorage.getItem(ADMIN_HOME_KEY);
  return value === '/workspace' ? '/workspace' : '/admin/dashboard';
}

export function setPreferredAdminHome(path: AdminHomePath): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(ADMIN_HOME_KEY, path);
}

export function syncPreferredAdminHome(path?: string | null): void {
  if (path === '/workspace' || path === '/admin/dashboard') {
    setPreferredAdminHome(path);
  }
}
