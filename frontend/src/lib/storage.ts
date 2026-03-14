const KEY = "yantu_admin_token";
export const ADMIN_TOKEN_CLEARED_EVENT = "yantu:admin-token-cleared";

export function getAdminToken(): string | null {
  return localStorage.getItem(KEY);
}

export function setAdminToken(token: string) {
  localStorage.setItem(KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(KEY);
  // Let shells react to token invalidation without relying on remounts.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ADMIN_TOKEN_CLEARED_EVENT));
}
