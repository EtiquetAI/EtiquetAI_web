export type UserRole = "USER" | "ADMIN";

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  role: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  phone_number?: string;
  role: UserRole;
  is_verified: boolean;
}

export class ApiHttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string) {
    super(`API request failed with status ${status}`);
    this.name = "ApiHttpError";
    this.status = status;
    this.code = code;
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super("Unable to connect to the API");
    this.name = "ApiNetworkError";
  }
}

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

class ApiResponseError extends Error {
  constructor() {
    super("The API returned an invalid response");
    this.name = "ApiResponseError";
  }
}

function getApiBaseUrl(): string {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");

  if (!configuredBaseUrl) {
    throw new ApiConfigurationError("VITE_API_BASE_URL is not configured.");
  }

  try {
    const url = new URL(configuredBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new ApiConfigurationError("VITE_API_BASE_URL must be a valid HTTP(S) URL.");
  }

  return configuredBaseUrl;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const url = `${getApiBaseUrl()}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiNetworkError();
  }

  let body: unknown;
  try {
    body = await readResponseBody(response);
  } catch {
    throw new ApiNetworkError();
  }

  if (!response.ok) {
    throw new ApiHttpError(response.status, readErrorCode(body));
  }

  return body;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readErrorCode(payload: unknown): string | undefined {
  if (isRecord(payload) && typeof payload.error === "string") {
    return payload.error;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTokenResponse(payload: unknown): TokenResponse {
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.access_token) ||
    !isNonEmptyString(payload.refresh_token) ||
    !isNonEmptyString(payload.role)
  ) {
    throw new ApiResponseError();
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    role: payload.role,
  };
}

function isUserRole(value: unknown): value is UserRole {
  return value === "USER" || value === "ADMIN";
}

function parseUser(payload: unknown): User {
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.id) ||
    !isNonEmptyString(payload.name) ||
    !isNonEmptyString(payload.email) ||
    !isUserRole(payload.role) ||
    typeof payload.is_verified !== "boolean"
  ) {
    throw new ApiResponseError();
  }

  const user: User = {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    is_verified: payload.is_verified,
  };

  if (typeof payload.phone_number === "string") {
    user.phone_number = payload.phone_number;
  }

  return user;
}

async function postJson(path: string, body: Record<string, string>): Promise<unknown> {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const response = await postJson("/api/v1/auth/login", { email, password });
  return parseTokenResponse(response);
}

export async function register(name: string, email: string, password: string): Promise<User> {
  const response = await postJson("/api/v1/auth/register", { name, email, password });
  return parseUser(response);
}

export async function refresh(refreshToken: string): Promise<TokenResponse> {
  const response = await postJson("/api/v1/auth/refresh", { refresh_token: refreshToken });
  return parseTokenResponse(response);
}

export async function getCurrentUser(accessToken: string): Promise<User> {
  const response = await request("/api/v1/users/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseUser(response);
}

export async function logout(accessToken: string): Promise<void> {
  await request("/api/v1/auth/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export const authApi = {
  login,
  register,
  refresh,
  getCurrentUser,
  logout,
};
