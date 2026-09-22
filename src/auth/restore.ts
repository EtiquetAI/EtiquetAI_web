import { ApiHttpError, authApi, type TokenResponse, type User } from "../api/auth.js";
import { clearSession, getAccessToken, getRefreshToken, saveSession } from "./session.js";

let refreshPromise: Promise<TokenResponse> | null = null;

export async function restoreUserSession(): Promise<User | null> {
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!accessToken || !refreshToken) {
    clearSession();
    return null;
  }

  try {
    return await authApi.getCurrentUser(accessToken);
  } catch (error) {
    if (!isUnauthorized(error)) {
      throw error;
    }
  }

  try {
    const tokens = await refreshSession(refreshToken);
    return await authApi.getCurrentUser(tokens.access_token);
  } catch (error) {
    clearSession();
    throw error;
  }
}

function refreshSession(refreshToken: string): Promise<TokenResponse> {
  if (refreshPromise === null) {
    refreshPromise = authApi
      .refresh(refreshToken)
      .then((tokens) => {
        saveSession(tokens);
        return tokens;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401;
}
