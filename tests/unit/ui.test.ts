import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNavigation } from "../../src/nav/AppNavigation.js";
import { MetricsPanel, formatRate, formatSeconds, sinceFor } from "../../src/metrics/MetricsPanel.js";
import { ResultsTable, matchesFilter } from "../../src/results/ResultsTable.js";
import { clearImageCache } from "../../src/results/ImageCache.js";
import { createReviewForm } from "../../src/results/ReviewForm.js";
import { UploadPanel, batchOptions, ocrProgress } from "../../src/upload/UploadPanel.js";
import { parseImageForTest } from "./parse.js";
import { flush, imagePayload, json, mockFetch, mountApp, readPayload } from "./helpers.js";
import { readsApi, type LabelRead } from "../../src/api/reads.js";

const token = () => "tok";

beforeEach(() => {
  mountApp();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:original"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearImageCache();
});

async function readOf(overrides: Record<string, unknown> = {}): Promise<LabelRead> {
  mockFetch({ "GET /api/v1/reads": () => json([readPayload(overrides)]) });
  const [read] = await readsApi.listReads("t");
  return read;
}

describe("the page", () => {
  it("has one panel for each navigation tab, metrics included", () => {
    expect(() => new AppNavigation(() => undefined)).not.toThrow();
    expect(document.querySelectorAll("[data-app-tab]").length).toBe(4);
  });
});

describe("review form", () => {
  it("starts clean, and saving sends only the field that changed", async () => {
    const read = await readOf();
    const { calls } = mockFetch({ "PATCH /api/v1/reads/read-1": () => json(readPayload({ destinatario: "MARIA GOMEZ", review_status: "corrected" })) });
    const onSaved = vi.fn();
    const form = createReviewForm(read, { getAccessToken: token, onSaved });
    document.body.appendChild(form);
    const save = form.querySelector<HTMLButtonElement>(".review-save")!;
    const confirm = form.querySelector<HTMLButtonElement>(".review-confirm")!;

    expect(save.disabled).toBe(true);
    expect(confirm.disabled).toBe(false);

    const name = form.querySelector<HTMLInputElement>('input[name="destinatario"]')!;
    name.value = "MARIA GOMEZ";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(save.disabled).toBe(false);
    expect(confirm.disabled).toBe(true);

    form.requestSubmit();
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({ destinatario: "MARIA GOMEZ" });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ review_status: "corrected" }));
  });

  it("confirms a read as it stands", async () => {
    const read = await readOf();
    const { calls } = mockFetch({ "PATCH /api/v1/reads/read-1": () => json(readPayload({ review_status: "confirmed" })) });
    const form = createReviewForm(read, { getAccessToken: token, onSaved: vi.fn() });

    form.querySelector<HTMLButtonElement>(".review-confirm")!.click();
    await flush();

    expect(calls[0].body).toEqual({ confirm: true });
  });

  it("marks the doubtful fields and offers the OCR's own value back", async () => {
    const read = await readOf({
      issues: ["missing_tracking"],
      confidence: { direccion: 0.3 },
      corrections: { destinatario: { original: "MARIA GOMEZ", corrected: "MARIA GOMES" } },
    });
    const form = createReviewForm(read, { getAccessToken: token, onSaved: vi.fn() });

    const doubtful = [...form.querySelectorAll(".review-field.is-doubtful input")].map((input) => (input as HTMLInputElement).name);
    expect(doubtful.sort()).toEqual(["direccion", "tracking"]);
    expect(form.querySelector(".review-original")?.textContent).toContain("MARIA GOMEZ");

    form.querySelector<HTMLButtonElement>(".review-restore")!.click();
    expect(form.querySelector<HTMLInputElement>('input[name="destinatario"]')!.value).toBe("MARIA GOMEZ");
    expect(form.querySelector<HTMLButtonElement>(".review-save")!.disabled).toBe(false);
  });

  it("explains a refusal and keeps what the person typed", async () => {
    const read = await readOf();
    mockFetch({ "PATCH /api/v1/reads/read-1": () => json({ error: "invalid_value" }, 400) });
    const onSaved = vi.fn();
    const form = createReviewForm(read, { getAccessToken: token, onSaved });
    const name = form.querySelector<HTMLInputElement>('input[name="destinatario"]')!;
    name.value = "x".repeat(300);
    name.dispatchEvent(new Event("input", { bubbles: true }));

    form.requestSubmit();
    await flush();

    expect(onSaved).not.toHaveBeenCalled();
    expect(form.querySelector(".review-state")?.textContent).toMatch(/demasiado largo/);
    expect(name.value).toHaveLength(300);
    expect(form.querySelector<HTMLButtonElement>(".review-save")!.disabled).toBe(false);
  });
});

describe("results table", () => {
  function tableWith(reads: unknown[]) {
    return mockFetch({
      "GET /api/v1/reads": () => json(reads),
      "GET /api/v1/images/image-1/file": () => new Response(new Blob(["img"]), { headers: { "Content-Type": "image/jpeg" } }),
    });
  }

  it("shows the review state of every read", async () => {
    tableWith([readPayload(), readPayload({ id: "read-2", review_status: "corrected", image_id: "image-2" })]);
    const table = new ResultsTable({ getAccessToken: token });

    await table.refresh();

    const badges = [...document.querySelectorAll<HTMLElement>("#resultsTableBody .review-badge")].map((badge) => badge.dataset.review);
    expect(badges).toEqual(["pending", "corrected"]);
  });

  it("filters on the server and says so when nothing matches", async () => {
    const { calls } = tableWith([readPayload()]);
    const table = new ResultsTable({ getAccessToken: token });
    await table.refresh();

    tableWith([]);
    const filtered = mockFetch({ "GET /api/v1/reads": () => json([]) });
    const select = document.getElementById("resultsFilterValidation") as HTMLSelectElement;
    select.value = "REJECTED";
    select.dispatchEvent(new Event("change"));
    await flush();

    expect(calls.length).toBeGreaterThan(0);
    expect(Object.fromEntries(filtered.calls[0].query)).toEqual({ validation_status: "REJECTED", limit: "20", offset: "0" });
    expect(document.getElementById("resultsTableStatus")?.textContent).toMatch(/Ninguna lectura coincide/);
    expect((document.getElementById("resultsFilterClear") as HTMLElement).hidden).toBe(false);
  });

  it("waits for the person to stop typing before it searches", async () => {
    vi.useFakeTimers();
    const { calls } = mockFetch({ "GET /api/v1/reads": () => json([]) });
    new ResultsTable({ getAccessToken: token });
    const input = document.getElementById("resultsFilterQuery") as HTMLInputElement;

    for (const text of ["g", "go", "gom"]) {
      input.value = text;
      input.dispatchEvent(new Event("input"));
      vi.advanceTimersByTime(100);
    }
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(400);

    expect(calls).toHaveLength(1);
    expect(calls[0].query.get("q")).toBe("gom");
  });

  it("offers the lots that were uploaded", () => {
    const table = new ResultsTable({ getAccessToken: token });

    table.setBatches([{ id: "b-1", label: "Lote del 03/11 · 6 imágenes" }]);

    const options = [...(document.getElementById("resultsFilterBatch") as HTMLSelectElement).options].map((option) => option.value);
    expect(options).toEqual(["", "b-1"]);
  });

  it("opens a read with its picture and saves a correction in place", async () => {
    const { calls } = mockFetch({
      "GET /api/v1/reads": () => json([readPayload()]),
      "GET /api/v1/images/image-1/file": () => new Response(new Blob(["img"]), { headers: { "Content-Type": "image/jpeg" } }),
      "PATCH /api/v1/reads/read-1": () => json(readPayload({ destinatario: "MARIA GOMEZ", review_status: "corrected", corrections: { destinatario: { original: "MARIA GOMES", corrected: "MARIA GOMEZ" } } })),
    });
    const table = new ResultsTable({ getAccessToken: token });
    await table.refresh();

    document.querySelector<HTMLButtonElement>(".result-detail-button")!.click();
    await flush();
    expect(document.querySelector(".review-image img")?.getAttribute("src")).toBe("blob:original");

    const name = document.querySelector<HTMLInputElement>('.review-form input[name="destinatario"]')!;
    name.value = "MARIA GOMEZ";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLFormElement>(".review-form")!.requestSubmit();
    await flush();

    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(document.querySelector("#resultsTableBody .review-badge")?.getAttribute("data-review")).toBe("corrected");
    expect(document.querySelector(".is-corrections")?.textContent).toContain("MARIA GOMES");
    expect(document.querySelector<HTMLElement>(".review-section .review-badge")?.dataset.review).toBe("corrected");
  });

  it("fetches the picture once even when the table redraws", async () => {
    const { calls } = tableWith([readPayload()]);
    const table = new ResultsTable({ getAccessToken: token });
    await table.refresh();

    document.querySelector<HTMLButtonElement>(".result-detail-button")!.click();
    await flush();
    await table.refresh();
    await flush();

    expect(calls.filter((call) => call.path.endsWith("/file"))).toHaveLength(1);
  });

  it("lists every label of a sheet", async () => {
    tableWith([
      readPayload({ label_count: 3, extra_labels: [{ destinatario: "ANA DIAZ", codigo_postal: "2000", destino: "ROSARIO", issues: [] }, { destinatario: "LUIS RUIZ", issues: [] }] }),
    ]);
    const table = new ResultsTable({ getAccessToken: token });
    await table.refresh();

    document.querySelector<HTMLButtonElement>(".result-detail-button")!.click();
    await flush();

    const items = [...document.querySelectorAll(".label-list-item")].map((item) => item.textContent);
    expect(items).toHaveLength(3);
    expect(items[1]).toContain("ANA DIAZ");
    expect(items[1]).toContain("2000 ROSARIO");
  });

  it("downloads the server's CSV with the active filters", async () => {
    const created: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => (created.push(blob), "blob:csv")), revokeObjectURL: vi.fn() }));
    const { calls } = mockFetch({
      "GET /api/v1/reads": () => json([readPayload()]),
      "GET /api/v1/reads/export": () => new Response("id\n", { headers: { "Content-Disposition": 'attachment; filename="lecturas.csv"' } }),
    });
    const table = new ResultsTable({ getAccessToken: token });
    const select = document.getElementById("resultsFilterReview") as HTMLSelectElement;
    select.value = "pending";
    select.dispatchEvent(new Event("change"));
    await flush();

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    (document.getElementById("exportCsvButton") as HTMLButtonElement).click();
    await flush();
    void table;

    const exported = calls.find((call) => call.path === "/api/v1/reads/export")!;
    expect(Object.fromEntries(exported.query)).toEqual({ review_status: "pending", format: "csv" });
    expect(created).toHaveLength(1);
  });

  it("keeps a read that arrives late out of a table filtered to something else", () => {
    const table = new ResultsTable({ getAccessToken: token });
    const select = document.getElementById("resultsFilterValidation") as HTMLSelectElement;
    select.value = "OK";
    mockFetch({ "GET /api/v1/reads": () => json([]) });
    select.dispatchEvent(new Event("change"));

    table.mergeReads([parseImageForTest(readPayload({ validation_status: "REVIEW" }))]);

    expect(document.querySelectorAll("#resultsTableBody tr:not(.table-empty)")).toHaveLength(0);
  });
});

describe("matchesFilter", () => {
  it("mirrors the server for state, review and text", () => {
    const read = parseImageForTest(readPayload({ review_status: "confirmed" }));

    expect(matchesFilter(read, {})).toBe(true);
    expect(matchesFilter(read, { validation: "OK" })).toBe(false);
    expect(matchesFilter(read, { review: "confirmed" })).toBe(true);
    expect(matchesFilter(read, { review: "pending" })).toBe(false);
    expect(matchesFilter(read, { query: "gomes" })).toBe(true);
    expect(matchesFilter(read, { query: "zzz" })).toBe(false);
  });
});

describe("upload panel", () => {
  function panel(options: { onUploaded?: (ids: string[]) => void; onPending?: (ids: string[]) => void; onBatches?: (b: unknown[]) => void } = {}) {
    return new UploadPanel({
      getAccessToken: token,
      onUploaded: (images) => options.onUploaded?.(images.map((image) => image.id)),
      onPendingImages: options.onPending,
      onBatches: options.onBatches,
    });
  }

  function choose(files: File[]): void {
    const input = document.getElementById("imageInput") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
  }

  it("unpacks a zip and reports what it left out", async () => {
    mockFetch({
      "POST /api/v1/images/batch": () =>
        json({ batch_id: "b-1", total: 3, accepted: [imagePayload({ id: "i1", batch_id: "b-1", ocr_status: "queued" }), imagePayload({ id: "i2", batch_id: "b-1", ocr_status: "queued" })], rejected: [{ filename: "notas.txt", reason: "not_an_image" }] }, 201),
      "GET /api/v1/images": () => json([imagePayload({ id: "i1", batch_id: "b-1", ocr_status: "queued" }), imagePayload({ id: "i2", batch_id: "b-1", ocr_status: "queued" })]),
    });
    const uploaded = vi.fn();
    const batches = vi.fn();
    panel({ onUploaded: uploaded, onBatches: batches });

    choose([new File(["zip"], "lote.zip", { type: "application/zip" })]);
    await flush();
    await flush();

    expect(uploaded).toHaveBeenCalledWith(["i1", "i2"]);
    expect(document.getElementById("uploadBatchReport")?.textContent).toContain("2 de 3 imágenes aceptadas");
    expect(document.getElementById("uploadBatchReport")?.textContent).toContain("notas.txt: no es una imagen válida");
    expect(document.getElementById("uploadProgress")?.textContent).toContain("2 imágenes esperando OCR");
    const lastBatches = batches.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(lastBatches.map((batch) => batch.id)).toEqual(["b-1"]);
  });

  it("puts several loose images in one batch", async () => {
    const { calls } = mockFetch({
      "POST /api/v1/images": () => json(imagePayload(), 201),
      "GET /api/v1/images": () => json([imagePayload()]),
    });
    panel();

    choose([new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.png", { type: "image/png" })]);
    await flush();
    await flush();

    const batchIds = calls.filter((call) => call.method === "POST").map((call) => (call.body as FormData).get("batch_id"));
    expect(batchIds).toHaveLength(2);
    expect(batchIds[0]).toBeTruthy();
    expect(batchIds[0]).toBe(batchIds[1]);
  });

  it("does not invent a batch for a single image", async () => {
    const { calls } = mockFetch({ "POST /api/v1/images": () => json(imagePayload(), 201), "GET /api/v1/images": () => json([imagePayload()]) });
    panel();

    choose([new File(["a"], "a.jpg", { type: "image/jpeg" })]);
    await flush();
    await flush();

    expect((calls.find((call) => call.method === "POST")!.body as FormData).get("batch_id")).toBeNull();
  });

  it("retries one failed image and follows it again", async () => {
    mockFetch({
      "GET /api/v1/images": () => json([imagePayload({ ocr_status: "not_queued" })]),
      "POST /api/v1/images/image-1/retry": () => json(imagePayload({ ocr_status: "queued" })),
    });
    const pending = vi.fn();
    const upload = panel({ onPending: pending });
    await upload.refresh();

    document.querySelector<HTMLButtonElement>(".uploaded-item-retry")!.click();
    await flush();

    expect(pending).toHaveBeenCalledWith(["image-1"]);
    expect(document.querySelector(".uploaded-item-retry")).toBeNull();
    expect(document.getElementById("uploadProgress")?.textContent).toContain("1 imagen esperando OCR");
  });

  it("retries every failed image at once", async () => {
    mockFetch({
      "GET /api/v1/images": () => json([imagePayload({ id: "a", ocr_status: "failed" }), imagePayload({ id: "b", ocr_status: "not_queued" })]),
      "POST /api/v1/images/retry-failed": () => json({ retried: 2, failed: 0, images: [imagePayload({ id: "a", ocr_status: "queued" }), imagePayload({ id: "b", ocr_status: "queued" })] }),
    });
    const pending = vi.fn();
    const upload = panel({ onPending: pending });
    await upload.refresh();
    const button = document.getElementById("retryFailedButton") as HTMLButtonElement;
    expect(button.hidden).toBe(false);

    button.click();
    await flush();

    expect(pending).toHaveBeenCalledWith(["a", "b"]);
    expect(button.hidden).toBe(true);
  });

  it("counts what the OCR is doing and groups lots newest first", () => {
    const images = [
      parseImg({ id: "1", ocr_status: "queued", batch_id: "old", created_at: "2026-11-01T10:00:00Z" }),
      parseImg({ id: "2", ocr_status: "failed", batch_id: "new", created_at: "2026-11-03T10:00:00Z" }),
      parseImg({ id: "3", ocr_status: "done", batch_id: "new", created_at: "2026-11-03T10:05:00Z" }),
      parseImg({ id: "4", ocr_status: "done" }),
    ];

    expect(ocrProgress(images)).toEqual({ waiting: 1, failed: 1, done: 2 });
    expect(batchOptions(images).map((batch) => batch.id)).toEqual(["new", "old"]);
    expect(batchOptions(images)[0].label).toContain("2 imágenes");
  });
});

describe("metrics panel", () => {
  const summary = {
    images: { total: 10, by_ocr_status: { done: 8, failed: 2 } },
    reads: { total: 8, by_validation: { OK: 5, REVIEW: 3 }, by_review: { confirmed: 2, corrected: 1, pending: 5 }, reviewed: 3, corrected: 1, correction_rate: 0.333, needs_attention_rate: 0.375, corrected_by_field: { destinatario: 1, tracking: 0 } },
    timing: { processed: 8, avg_seconds: 4.2, images_per_minute: 12.5 },
  };

  it("shows the figures the report needs, in Spanish", async () => {
    mockFetch({ "GET /api/v1/metrics/summary": () => json(summary) });
    const panel = new MetricsPanel({ getAccessToken: token });

    await panel.refresh();

    const value = (key: string) => document.querySelector(`[data-metric="${key}"] .metric-value`)?.textContent;
    expect(value("processed")).toBe("8");
    expect(value("avg-time")).toBe("4,2 s");
    expect(value("throughput")).toContain("12,5");
    expect(value("correction-rate")).toBe("33,3%");
    expect(document.querySelector('[data-group="by-field"]')?.textContent).toContain("Destinatario");
    expect(document.querySelector('[data-group="by-field"] [data-key="tracking"]')).toBeNull();
  });

  it("asks for a period and explains an empty history", async () => {
    const { calls } = mockFetch({
      "GET /api/v1/metrics/summary": () =>
        json({ ...summary, reads: { ...summary.reads, reviewed: 0, corrected: 0, correction_rate: null }, timing: { processed: 0, avg_seconds: null, images_per_minute: null } }),
    });
    const panel = new MetricsPanel({ getAccessToken: token });
    const period = document.getElementById("metricsPeriod") as HTMLSelectElement;
    period.value = "7";

    await panel.refresh();

    expect(calls[0].query.get("since")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(document.querySelector('[data-metric="correction-rate"] .metric-value')?.textContent).toBe("—");
    expect(document.querySelector('[data-metric="correction-rate"] .metric-hint')?.textContent).toMatch(/todavía no se revisó/);
  });

  it("formats rates and durations", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatSeconds(90)).toBe("1,5 min");
    expect(sinceFor("", new Date("2026-11-03T00:00:00Z"))).toBeUndefined();
    expect(sinceFor("1", new Date("2026-11-03T00:00:00Z"))).toBe("2026-11-02T00:00:00.000Z");
  });
});

function parseImg(overrides: Record<string, unknown>) {
  return { id: "x", filename: "f.jpg", mime_type: "image/jpeg", size_bytes: 1, status: "processed" as const, created_at: "2026-11-03T10:00:00Z", ...overrides } as Parameters<typeof ocrProgress>[0][number];
}
