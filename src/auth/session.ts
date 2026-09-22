import type { TokenResponse } from "../api/auth.js";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

export function saveSession(tokens: Pick<TokenResponse, "access_token" | "refresh_token">): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

export function getAccessToken(): string | null {
  return getStoredToken(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return getStoredToken(REFRESH_TOKEN_KEY);
}

export function clearSession(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

function getStoredToken(key: string): string | null {
  const token = sessionStorage.getItem(key);
  return token?.trim() || null;
}
