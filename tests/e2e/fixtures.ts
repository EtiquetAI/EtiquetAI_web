import { test as base, expect, type Page, type Request } from "@playwright/test";
import type { User } from "../../src/api/auth.js";
import type { UploadedImage } from "../../src/api/images.js";
import type { LabelRead } from "../../src/api/reads.js";

export const API_ORIGIN = "http://127.0.0.1:4174";
export const user: User = {
  id: "user-test", name: "Test Operator", email: "operator@example.test",
  role: "USER", is_verified: false,
};
export const tokens = { access_token: "test-access", refresh_token: "test-refresh", role: "USER" };
export const ocrRead: LabelRead = {
  id: "read-test", content: "DESTINATARIO: ANA TEST — DESTINO: ROSARIO",
  source: "image", image_id: "image-test", filename: "label.png",
  destino: "ROSARIO", codigo_postal: "2000", destinatario: "ANA TEST",
  tracking: "AR123456789", created_at: "2026-01-01T12:00:00Z",
};

// A decodable one-pixel PNG. Recognition is deliberately not part of UI tests.
export const pngFile = {
  name: "label.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
};

export class MockAPI {
  readonly requests: Request[] = [];
  readonly unexpected: string[] = [];
  readonly expectedAborts = new WeakSet<Request>();
  private readonly expectedResourceErrors = new Map<string, number>();
  reads: LabelRead[] = [];
  images: UploadedImage[] = [];
  loginStatus = 200;
  registrationStatus = 201;
  refreshStatus = 200;
  uploadStatus = 201;
  readsStatus = 200;
  deleteStatus = 204;
  expiredAccess = false;
  abortLogin = false;
  abortLogout = false;
  loginGate: Promise<void> | undefined;
  ocrResult: LabelRead | undefined;
  emptyPolls = 0;

  matching(method: string, pathname: string): Request[] {
    return this.requests.filter((request) =>
      request.method() === method && new URL(request.url()).pathname === pathname);
  }

  expectResourceError(url: string, reason: string): void {
    const key = `${url}|${reason}`;
    this.expectedResourceErrors.set(key, (this.expectedResourceErrors.get(key) ?? 0) + 1);
  }

  consumeResourceError(url: string, text: string): boolean {
    if (!text.startsWith("Failed to load resource:")) return false;
    const reason = text.match(/status of (\d+)/)?.[1] ?? (text.includes("net::ERR_FAILED") ? "abort" : "unknown");
    const key = `${url}|${reason}`;
    const remaining = this.expectedResourceErrors.get(key) ?? 0;
    if (remaining === 0) return false;
    this.expectedResourceErrors.set(key, remaining - 1);
    return true;
  }
}

export const test = base.extend<{ api: MockAPI }>({
  api: [async ({ context }, use) => {
    const api = new MockAPI();
    // Intercept every request: unexpected external destinations must never be reached.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === "http://127.0.0.1:4173") {
        if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
        return route.continue();
      }
      // Fonts are decorative; tests must work offline without contacting Google.
      if (url.hostname === "fonts.googleapis.com") {
        return route.fulfill({ contentType: "text/css", body: "" });
      }
      if (url.origin !== API_ORIGIN) {
        api.unexpected.push(`${request.method()} ${request.url()}`);
        return route.fulfill({ status: 403, body: "External requests blocked in UI tests" });
      }
      api.requests.push(request);
      const method = request.method();
      const path = url.pathname;
      const json = (status: number, body: unknown) => {
        if (status >= 400) api.expectResourceError(request.url(), String(status));
        return route.fulfill({ status, json: body });
      };
      const abort = () => {
        api.expectedAborts.add(request);
        api.expectResourceError(request.url(), "abort");
        return route.abort("failed");
      };
      if (method === "POST" && path === "/api/v1/auth/login") {
        await api.loginGate;
        if (api.abortLogin) return abort();
        return json(api.loginStatus, api.loginStatus === 200 ? tokens : { error: "invalid_credentials" });
      }
      if (method === "POST" && path === "/api/v1/auth/register") {
        return json(api.registrationStatus, api.registrationStatus === 201 ? user : { error: "email_already_registered" });
      }
      if (method === "POST" && path === "/api/v1/auth/refresh") {
        return json(api.refreshStatus, api.refreshStatus === 200 ? tokens : { error: "invalid_refresh_token" });
      }
      if (method === "GET" && path === "/api/v1/users/me") {
        if (api.expiredAccess && request.headers().authorization === "Bearer expired-access") {
          return json(401, { error: "unauthorized" });
        }
        return json(200, user);
      }
      if (method === "POST" && path === "/api/v1/auth/logout") {
        return api.abortLogout ? abort() : route.fulfill({ status: 204 });
      }
      if (method === "GET" && path === "/api/v1/images") return json(200, api.images);
      if (method === "POST" && path === "/api/v1/images") {
        if (api.uploadStatus !== 201) return json(api.uploadStatus, { error: "invalid_request" });
        const filename = request.postDataBuffer()?.toString().match(/filename="([^"]+)"/)?.[1];
        const image: UploadedImage = {
          id: "image-test", filename: filename ?? "label.png", mime_type: "image/png",
          size_bytes: pngFile.buffer.length, status: "processed", created_at: ocrRead.created_at,
        };
        api.images.push(image);
        return json(201, image);
      }
      if (method === "GET" && path === "/api/v1/reads") {
        if (api.readsStatus !== 200) return json(api.readsStatus, { error: "internal_error" });
        if (url.searchParams.has("image_ids") && api.ocrResult) {
          if (api.emptyPolls-- > 0) return json(200, []);
          api.reads = [api.ocrResult];
        }
        return json(200, api.reads);
      }
      if (method === "DELETE" && (path === "/api/v1/reads" || path.startsWith("/api/v1/reads/"))) {
        if (api.deleteStatus !== 204) return json(api.deleteStatus, { error: "internal_error" });
        api.reads = path === "/api/v1/reads" ? [] : api.reads.filter((read) => path !== `/api/v1/reads/${read.id}`);
        return route.fulfill({ status: 204 });
      }
      api.unexpected.push(`${method} ${request.url()}`);
      return route.fulfill({ status: 501, json: { error: "unmocked_request" } });
    });
    await use(api);
    expect(api.unexpected, "All API requests must have an explicit mock").toEqual([]);
  }, { auto: true }],
  page: async ({ page, api }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (api.consumeResourceError(message.location().url, message.text())) return;
      errors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (!api.expectedAborts.has(request)) errors.push(`Unexpected failed request: ${request.url()}`);
    });
    await use(page);
    expect(errors, "No unexpected browser or network errors").toEqual([]);
  },
});

export { expect };

export async function restoreSession(page: Page, accessToken = tokens.access_token): Promise<void> {
  await page.addInitScript(({ accessToken, refreshToken }) => {
    sessionStorage.setItem("access_token", accessToken);
    sessionStorage.setItem("refresh_token", refreshToken);
  }, { accessToken, refreshToken: tokens.refresh_token });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
}

export async function openLogin(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  // View entry moves focus on requestAnimationFrame; wait before typing so it
  // cannot steal focus in the middle of filling a different input.
  await expect(page.locator("#email")).toBeFocused();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("test-password-123");
}
