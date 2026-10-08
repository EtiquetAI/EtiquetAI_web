import { ApiHttpError } from "./auth.js";

export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!configured) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }
  return configured;
}

export async function authorizedRequest(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, { ...init, headers });
  } catch {
    throw new Error("No se pudo conectar con la API.");
  }

  if (!response.ok) {
    throw new ApiHttpError(response.status, await readErrorCode(response));
  }
  return response;
}

export async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const code = (body as { error: unknown }).error;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
