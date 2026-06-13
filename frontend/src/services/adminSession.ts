import { authApi } from './adminService';
import { clearAdminSession, getAdminToken, syncPreferredAdminHome } from '../utils/adminAuth';

const SESSION_CACHE_TTL_MS = 5000;
const SESSION_VERIFY_TIMEOUT_MS = 8000;

let inflightVerifyPromise: Promise<boolean> | null = null;
let cachedToken: string | null = null;
let cachedVerifiedAt = 0;
let cachedVerifiedResult = false;

export async function verifyAdminSession(): Promise<boolean> {
  const token = getAdminToken();
  if (!token) {
    cachedToken = null;
    cachedVerifiedAt = 0;
    cachedVerifiedResult = false;
    inflightVerifyPromise = null;
    return false;
  }

  const now = Date.now();
  if (cachedToken === token && now - cachedVerifiedAt < SESSION_CACHE_TTL_MS) {
    return cachedVerifiedResult;
  }

  if (inflightVerifyPromise) {
    return inflightVerifyPromise;
  }

  inflightVerifyPromise = (async () => {
    try {
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('SESSION_VERIFY_TIMEOUT')), SESSION_VERIFY_TIMEOUT_MS);
      });
      const user = await Promise.race([authApi.getCurrentUser(), timeout]);
      syncPreferredAdminHome(user?.preferred_home_path);
      cachedToken = token;
      cachedVerifiedAt = Date.now();
      cachedVerifiedResult = true;
      return true;
    } catch {
      clearAdminSession();
      cachedToken = null;
      cachedVerifiedAt = 0;
      cachedVerifiedResult = false;
      return false;
    } finally {
      inflightVerifyPromise = null;
    }
  })();

  return inflightVerifyPromise;
}

export async function logoutAdminSession(): Promise<void> {
  inflightVerifyPromise = null;
  cachedToken = null;
  cachedVerifiedAt = 0;
  cachedVerifiedResult = false;
  try {
    await authApi.logout();
  } catch {
    clearAdminSession();
  }
}
