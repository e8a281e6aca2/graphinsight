import { useEffect, useState } from 'react';
import { verifyAdminSession, logoutAdminSession } from '../services/adminSession';
import { getAdminToken, subscribeAdminSessionChange } from '../utils/adminAuth';

type AdminSessionState = 'checking' | 'authenticated' | 'anonymous';

export function useAdminSession() {
  const [status, setStatus] = useState<AdminSessionState>('checking');

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const authenticated = await verifyAdminSession();
      if (!cancelled) {
        setStatus(authenticated ? 'authenticated' : 'anonymous');
      }
    }

    void verify();
    const unsubscribe = subscribeAdminSessionChange((authenticated) => {
      if (cancelled) {
        return;
      }
      setStatus(authenticated ? 'authenticated' : 'anonymous');
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (status !== 'checking') {
      return;
    }
    if (!getAdminToken()) {
      setStatus('anonymous');
    }
  }, [status]);

  return {
    status,
    isChecking: status === 'checking',
    isAuthenticated: status === 'authenticated',
    isAnonymous: status === 'anonymous',
    logout: logoutAdminSession,
  };
}
