/**
 * Failures seen on real use, each pinned by a test:
 *  - the status of an uploaded image never left "Esperando OCR" (the watcher gave up after 15-120 s
 *    while the OCR needed minutes), and results trickled in with no word that more were coming;
 *  - Guardar / Confirmar did nothing, because every poll rebuilt the table under the person's hands;
 *  - a second account saw the first one's scanned codes, uploads and results.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OcrWatcher } from "../../src/ocr/OcrWatcher.js";
import { LocalStorageQRCodeStorage } from "../../src/implementations/LocalStorageQRCodeStorage.js";
import { MetricsPanel } from "../../src/metrics/MetricsPanel.js";
import { clearImageCache } from "../../src/results/ImageCache.js";
import { ResultsTable, expandLabels } from "../../src/results/ResultsTable.js";
import { issueField } from "../../src/results/status.js";
import { UploadPanel } from "../../src/upload/UploadPanel.js";
import { readsApi } from "../../src/api/reads.js";
import { parseImageForTest } from "./parse.js";
import { flush, imagePayload, json, mockFetch, mountApp, readPayload } from "./helpers.js";

const token = () => "tok";

beforeEach(() => {
  mountApp();
  localStorage.clear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearImageCache();
});

describe("following the OCR", () => {
  function handlers() {
    return { onImages: vi.fn(), onReads: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() };
  }

  it("keeps following an image the OCR is still working on, however long it takes", async () => {
    vi.useFakeTimers();
    let status = "queued";
    mockFetch({
      "GET /api/v1/images": () => json([imagePayload({ ocr_status: status })]),
      "GET /api/v1/reads": () => json([]),
    });
    const h = handlers();
    const watch = new OcrWatcher({ getAccessToken: token, handlers: h }).watch(["image-1"]);

    // The watcher used to give up after 15 s for a small batch (120 s at most).
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(h.onTimeout).not.toHaveBeenCalled();

    status = "done";
    await vi.advanceTimersByTimeAsync(10_000);
    await watch;

    expect(h.onTimeout).not.toHaveBeenCalled();
    expect(h.onImages.mock.calls.at(-1)?.[0][0].ocr_status).toBe("done");
  });

  it("gives up only when nothing has finished for a long while, and says how many are left", async () => {
    vi.useFakeTimers();
    mockFetch({
      "GET /api/v1/images": () => json([imagePayload({ ocr_status: "queued" })]),
      "GET /api/v1/reads": () => json([]),
    });
    const h = handlers();
    const watch = new OcrWatcher({ getAccessToken: token, handlers: h }).watch(["image-1"]);

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    await watch;

    expect(h.onTimeout).toHaveBeenCalledWith(1);
  });

  it("counts progress: a batch that keeps finishing images is never abandoned", async () => {
    vi.useFakeTimers();
    let done = 0;
    mockFetch({
      "GET /api/v1/images": (call) => {
        const ids = (call.query.get("ids") ?? "").split(",");
        return json(ids.map((id, index) => imagePayload({ id, ocr_status: index < done ? "done" : "queued" })));
      },
      "GET /api/v1/reads": () => json([]),
    });
    const h = handlers();
    const ids = ["a", "b", "c", "d", "e", "f"];
    const watch = new OcrWatcher({ getAccessToken: token, handlers: h }).watch(ids);

    // One image every four minutes: far longer than the old fixed limit, still progress.
    for (let step = 1; step <= 6; step++) {
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      done = step;
    }
    await vi.advanceTimersByTimeAsync(20_000);
    await watch;

    expect(h.onTimeout).not.toHaveBeenCalled();
  });
});

describe("a table that is being used", () => {
  const row = (id: string, overrides: Record<string, unknown> = {}) =>
    parseImageForTest(readPayload({ id, image_id: `image-${id}`, ...overrides }));

  /** A read shaped exactly as the API answers it, which is what the watcher hands to the table. */
  async function apiRow(id: string, overrides: Record<string, unknown> = {}) {
    mockFetch({ "GET /api/v1/reads": () => json([readPayload({ id, image_id: `image-${id}`, ...overrides })]) });
    return (await readsApi.listReads("t"))[0];
  }

  async function tableWith(reads: unknown[]) {
    mockFetch({
      "GET /api/v1/reads": () => json(reads),
      "GET /api/v1/images/image-1/file": () => new Response(new Blob(["i"]), { headers: { "Content-Type": "image/jpeg" } }),
    });
    const table = new ResultsTable({ getAccessToken: token });
    await table.refresh();
    return table;
  }

  it("is not rebuilt when a poll brings the very same reads", async () => {
    const table = await tableWith([readPayload({ id: "1", image_id: "image-1" })]);
    const before = document.querySelector("#resultsTableBody tr");
    const same = await apiRow("1");

    table.mergeReads([same]);
    table.mergeReads([same]);

    expect(document.querySelector("#resultsTableBody tr")).toBe(before);
  });

  it("does not wipe a correction that is being typed when another result arrives", async () => {
    const table = await tableWith([readPayload({ id: "1", image_id: "image-1" })]);
    document.querySelector<HTMLButtonElement>(".result-detail-button")!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('.review-form input[name="destinatario"]')!;
    input.value = "MARIA GOMEZ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    table.mergeReads([row("2", { destinatario: "NUEVA PERSONA", created_at: "2026-11-04T12:00:00Z" })]);

    // The new read waits; what the person typed is still there, in the same field.
    expect(document.querySelector<HTMLInputElement>('.review-form input[name="destinatario"]')).toBe(input);
    expect(input.value).toBe("MARIA GOMEZ");
    expect(document.querySelectorAll("#resultsTableBody > tr.result-row, #resultsTableBody > tr[data-read-id]").length).toBeLessThanOrEqual(2);
  });

  it("shows the read that was held back once the correction is saved", async () => {
    mockFetch({
      "GET /api/v1/reads": () => json([readPayload({ id: "1", image_id: "image-1" })]),
      "GET /api/v1/images/image-1/file": () => new Response(new Blob(["i"]), { headers: { "Content-Type": "image/jpeg" } }),
      "PATCH /api/v1/reads/1": () => json(readPayload({ id: "1", image_id: "image-1", destinatario: "MARIA GOMEZ", review_status: "corrected" })),
    });
    const table = new ResultsTable({ getAccessToken: token });
    await table.refresh();
    document.querySelector<HTMLButtonElement>(".result-detail-button")!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>('.review-form input[name="destinatario"]')!;
    input.value = "MARIA GOMEZ";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    table.mergeReads([row("2", { destinatario: "NUEVA PERSONA", created_at: "2026-11-04T12:00:00Z" })]);

    document.querySelector<HTMLFormElement>(".review-form")!.requestSubmit();
    await flush();

    const names = [...document.querySelectorAll("#resultsTableBody td")].map((cell) => cell.textContent);
    expect(names).toContain("NUEVA PERSONA");
    expect(names).toContain("MARIA GOMEZ");
  });

  it("does not rebuild under a click that is half done", async () => {
    const table = await tableWith([readPayload({ id: "1", image_id: "image-1" })]);
    const tbody = document.getElementById("resultsTableBody")!;
    const before = tbody.querySelector("tr");

    tbody.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    table.mergeReads([row("2", { destinatario: "OTRA", created_at: "2026-11-04T12:00:00Z" })]);
    expect(tbody.querySelector("tr")).toBe(before);

    document.dispatchEvent(new Event("pointerup"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(tbody.textContent).toContain("OTRA");
  });

  it("says how many images are still being read", async () => {
    const table = await tableWith([]);
    const notice = document.getElementById("resultsPending") as HTMLElement;

    table.setPendingCount(3);
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("3 imágenes todavía se están procesando");

    table.setPendingCount(1);
    expect(notice.textContent).toContain("1 imagen todavía se está procesando");

    table.setPendingCount(0);
    expect(notice.hidden).toBe(true);
  });

  it("takes the person from a reason to the field it is about", async () => {
    await tableWith([readPayload({ id: "1", image_id: "image-1", issues: ["missing_tracking", "multiple_labels_detected"] })]);
    document.querySelector<HTMLButtonElement>(".result-detail-button")!.click();
    await flush();

    const reasons = [...document.querySelectorAll<HTMLElement>("[data-issue]")];
    expect(reasons.find((r) => r.dataset.issue === "multiple_labels_detected")?.querySelector("button")).toBeNull();
    reasons.find((r) => r.dataset.issue === "missing_tracking")!.querySelector<HTMLButtonElement>("button.issue-link")!.click();

    expect(document.activeElement).toBe(document.getElementById("review-1-tracking"));
  });

  it("maps each kind of reason to its field", () => {
    expect(issueField("missing_tracking")).toBe("tracking");
    expect(issueField("low_confidence_destinatario")).toBe("destinatario");
    expect(issueField("implausible_direccion")).toBe("direccion");
    expect(issueField("postal_code_mismatch")).toBe("codigo_postal");
    expect(issueField("multiple_labels_detected")).toBeNull();
  });
});

describe("another account", () => {
  it("never sees the codes the previous one scanned", async () => {
    let user: string | null = "ana";
    const storage = new LocalStorageQRCodeStorage(() => user);
    await storage.save("CODE-ANA");

    user = "bob";
    expect(await storage.list()).toEqual([]);
    await storage.save("CODE-BOB");

    user = "ana";
    expect(await storage.list()).toEqual(["CODE-ANA"]);
    user = "bob";
    expect(await storage.list()).toEqual(["CODE-BOB"]);
  });

  it("reads and writes nothing without a signed-in account", async () => {
    const storage = new LocalStorageQRCodeStorage(() => null);

    await storage.save("X");

    expect(await storage.list()).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("drops the list the old versions shared between every account", () => {
    localStorage.setItem("qr_scanner_detected_codes", JSON.stringify(["OLD"]));

    new LocalStorageQRCodeStorage(() => "ana").purgeLegacy();

    expect(localStorage.getItem("qr_scanner_detected_codes")).toBeNull();
  });

  it("starts the results table from nothing, and ignores an answer meant for the previous account", async () => {
    let release: () => void = () => undefined;
    mockFetch({
      "GET /api/v1/reads": () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json([readPayload({ id: "ana-1" })]));
        }),
    });
    const table = new ResultsTable({ getAccessToken: token });
    table.setPendingCount(2);
    const refreshing = table.refresh();

    table.reset();
    release();
    await refreshing;

    expect(document.getElementById("resultsTableBody")!.textContent).not.toContain("MARIA");
    expect((document.getElementById("resultsPending") as HTMLElement).hidden).toBe(true);
  });

  it("empties the upload list, the report and the progress", async () => {
    mockFetch({ "GET /api/v1/images": () => json([imagePayload({ ocr_status: "queued" }), imagePayload({ id: "i2", ocr_status: "not_queued" })]) });
    const panel = new UploadPanel({ getAccessToken: token, onUploaded: vi.fn() });
    await panel.refresh();
    expect(document.querySelectorAll("#uploadedList li").length).toBe(2);

    panel.reset();

    expect(document.querySelectorAll("#uploadedList li").length).toBe(0);
    expect(document.getElementById("uploadProgress")!.hidden).toBe(true);
    expect(document.getElementById("uploadBatchReport")!.textContent).toBe("");
  });

  it("empties the metrics", async () => {
    mockFetch({
      "GET /api/v1/metrics/summary": () =>
        json({
          images: { total: 1, by_ocr_status: { done: 1 } },
          reads: { total: 1, by_validation: { OK: 1 }, by_review: {}, reviewed: 0, corrected: 0, correction_rate: null, needs_attention_rate: 0, corrected_by_field: {} },
          timing: { processed: 1, avg_seconds: 3, images_per_minute: 1 },
        }),
    });
    const panel = new MetricsPanel({ getAccessToken: token });
    await panel.refresh();
    expect(document.getElementById("metricsBody")!.children.length).toBeGreaterThan(0);

    panel.reset();

    expect(document.getElementById("metricsBody")!.children.length).toBe(0);
  });
});

describe("the upload list", () => {
  it("is not redrawn when a poll brings the same state again", async () => {
    mockFetch({ "GET /api/v1/images": () => json([imagePayload({ ocr_status: "queued" })]) });
    const panel = new UploadPanel({ getAccessToken: token, onUploaded: vi.fn() });
    await panel.refresh();
    const before = document.querySelector("#uploadedList li");

    await panel.refresh();

    expect(document.querySelector("#uploadedList li")).toBe(before);
  });

  it("tells how many images are still waiting, and offers to look again", async () => {
    const { calls } = mockFetch({ "GET /api/v1/images": () => json([imagePayload({ ocr_status: "queued" }), imagePayload({ id: "i2", ocr_status: "queued" })]) });
    const onPendingCount = vi.fn();
    const panel = new UploadPanel({ getAccessToken: token, onUploaded: vi.fn(), onPendingCount });
    await panel.refresh();

    expect(onPendingCount).toHaveBeenLastCalledWith(2);
    const button = document.getElementById("refreshUploadsButton") as HTMLButtonElement;
    expect(button.hidden).toBe(false);

    const before = calls.length;
    button.click();
    await flush();

    expect(calls.length).toBeGreaterThan(before);
  });
});

describe("exporting a sheet", () => {
  it("gives every label of a sheet its own row, so none is lost", async () => {
    mockFetch({
      "GET /api/v1/reads": () =>
        json([
          readPayload({
            label_count: 3,
            extra_labels: [
              { destinatario: "ANA DIAZ", codigo_postal: "2000", destino: "ROSARIO", validation_status: "OK", issues: [] },
              { destinatario: "LUIS RUIZ", validation_status: "REVIEW", issues: ["missing_tracking"] },
            ],
          }),
          readPayload({ id: "read-2", image_id: "image-2" }),
        ]),
    });
    const [sheet, single] = await readsApi.listReads("t");

    const rows = expandLabels([sheet, single]);

    expect(rows.map((row) => row.destinatario)).toEqual(["MARIA GOMES", "ANA DIAZ", "LUIS RUIZ", "MARIA GOMES"]);
    expect(rows.map((row) => row.id)).toEqual(["read-1", "read-1#2", "read-1#3", "read-2"]);
    expect(rows[2].validation_status).toBe("REVIEW");
    expect(rows[2].issues).toEqual(["missing_tracking"]);
  });
});
