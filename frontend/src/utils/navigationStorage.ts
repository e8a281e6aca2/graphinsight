export type NavigationHistoryItem = {
  name?: string;
  timestamp: number;
  zoom: number;
  center: { x: number; y: number };
};

export type NewNavigationHistoryItem = Omit<NavigationHistoryItem, 'timestamp'> & {
  timestamp?: number;
};

export type GraphBookmark = {
  id: string;
  name: string;
  timestamp: number;
  zoom: number;
  center: { x: number; y: number };
  selectedNodeId?: string;
  lastUsedAt?: number;
};

const BOOKMARK_KEY = 'graphBookmarks';
const HISTORY_KEY = 'navigationHistory';

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('Failed to parse storage payload:', error);
    return fallback;
  }
}

export function loadBookmarks(): GraphBookmark[] {
  const data = safeParse<GraphBookmark[]>(localStorage.getItem(BOOKMARK_KEY), []);
  return Array.isArray(data) ? data : [];
}

export function saveBookmarks(bookmarks: GraphBookmark[]) {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks));
  window.dispatchEvent(new CustomEvent('graphBookmarksUpdated'));
}

export function addBookmark(bookmark: GraphBookmark) {
  const bookmarks = loadBookmarks();
  bookmarks.push(bookmark);
  saveBookmarks(bookmarks);
  return bookmarks;
}

export function loadNavigationHistory(): NavigationHistoryItem[] {
  const data = safeParse<NavigationHistoryItem[]>(localStorage.getItem(HISTORY_KEY), []);
  return Array.isArray(data) ? data : [];
}

export function addNavigationHistory(item: NewNavigationHistoryItem, limit = 20) {
  const timestamp = item.timestamp ?? Date.now();
  const normalized: NavigationHistoryItem = {
    ...item,
    timestamp,
    name: item.name ?? `视图 ${new Date(timestamp).toLocaleTimeString()}`,
  };
  const history = loadNavigationHistory();
  history.unshift(normalized);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, limit)));
  window.dispatchEvent(new CustomEvent('navigationHistoryUpdated'));
}
