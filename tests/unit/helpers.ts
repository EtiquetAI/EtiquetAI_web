import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

/** Puts the real index.html into the document, without running its scripts. */
export function mountApp(): void {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf-8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script").forEach((script) => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
}

export interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Headers;
}

type Handler = (call: Call) => Response | Promise<Response>;

/** A fetch that answers from a table of `"METHOD /path"` handlers and remembers every call. */
export function mockFetch(routes: Record<string, Handler>): { calls: Call[] } {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const method = (init.method ?? "GET").toUpperCase();
      let body: unknown = init.body;
      if (typeof init.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const call: Call = { method, path: url.pathname, query: url.searchParams, body, headers: new Headers(init.headers) };
      calls.push(call);
      const handler = routes[`${method} ${url.pathname}`];
      if (!handler) return json({ error: "unmocked" }, 599);
      return handler(call);
    }),
  );
  return { calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export const flush = (): Promise<void> => new Promise((resolveFlush) => setTimeout(resolveFlush, 0));

export function readPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "read-1",
    content: "x",
    source: "image",
    image_id: "image-1",
    filename: "label.jpg",
    destinatario: "MARIA GOMES",
    direccion: "AV. CORRIENTES 1234",
    codigo_postal: "1043",
    destino: "CABA",
    tracking: null,
    validation_status: "REVIEW",
    issues: ["missing_tracking"],
    confidence: { destinatario: 0.9, direccion: 0.4 },
    review_status: "pending",
    corrections: {},
    label_count: 1,
    extra_labels: [],
    created_at: "2026-11-03T12:00:00Z",
    ...overrides,
  };
}

export function imagePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "image-1",
    filename: "label.jpg",
    mime_type: "image/jpeg",
    size_bytes: 1000,
    status: "processed",
    created_at: "2026-11-03T12:00:00Z",
    ocr_status: "done",
    ...overrides,
  };
}
