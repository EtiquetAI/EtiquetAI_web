import { afterEach, describe, expect, it, vi } from "vitest";
import { imagesApi } from "../../src/api/images.js";
import { filterQuery, isFilterActive, readsApi } from "../../src/api/reads.js";
import { parseSummary } from "../../src/api/metrics.js";
import { doubtfulFields } from "../../src/results/status.js";
import { imagePayload, json, mockFetch, readPayload } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

describe("reads api", () => {
  it("parses review state, corrections and extra labels", async () => {
    mockFetch({
      "GET /api/v1/reads": () =>
        json([
          readPayload({
            review_status: "corrected",
            reviewed_at: "2026-11-03T13:00:00Z",
            corrections: { destinatario: { original: "MARIA GOMEZ", corrected: "MARIA GOMES", at: "2026-11-03T13:00:00Z" } },
            label_count: 3,
            extra_labels: [{ destinatario: "ANA", codigo_postal: "2000", validation_status: "OK", issues: ["x"] }],
          }),
        ]),
    });

    const [read] = await readsApi.listReads("t");

    expect(read.review_status).toBe("corrected");
    expect(read.corrections?.destinatario?.original).toBe("MARIA GOMEZ");
    expect(read.label_count).toBe(3);
    expect(read.extra_labels?.[0]).toMatchObject({ destinatario: "ANA", codigo_postal: "2000", validation_status: "OK" });
  });

  it("reads an older API that sends none of the review fields", async () => {
    mockFetch({ "GET /api/v1/reads": () => json([{ id: "r", content: "c", source: "camera", created_at: "2026-01-01T00:00:00Z" }]) });

    const [read] = await readsApi.listReads("t");

    expect(read.review_status).toBe("pending");
    expect(read.label_count).toBe(1);
    expect(read.extra_labels).toEqual([]);
  });

  it("asks for the plain list when nothing filters it, and adds only the filters in use", async () => {
    const { calls } = mockFetch({ "GET /api/v1/reads": () => json([]) });

    await readsApi.listReads("t");
    await readsApi.listReads("t", { validation: "REVIEW", review: "pending", batchId: "b-1", query: "  gomez " });

    expect(calls[0].query.toString()).toBe("");
    expect(Object.fromEntries(calls[1].query)).toEqual({ validation_status: "REVIEW", review_status: "pending", batch_id: "b-1", q: "gomez" });
    expect(isFilterActive({})).toBe(false);
    expect(filterQuery({ query: "   " })).toBe("");
  });

  it("sends only what the person changed", async () => {
    const { calls } = mockFetch({ "PATCH /api/v1/reads/read-1": () => json(readPayload({ review_status: "corrected" })) });

    const updated = await readsApi.updateRead("read-1", { destinatario: "MARIA GOMEZ", tracking: "" }, "t");

    expect(calls[0].body).toEqual({ destinatario: "MARIA GOMEZ", tracking: "" });
    expect(calls[0].headers.get("Authorization")).toBe("Bearer t");
    expect(updated.review_status).toBe("corrected");
  });

  it("exports with the filters and the filename the server chose", async () => {
    const { calls } = mockFetch({
      "GET /api/v1/reads/export": () =>
        new Response("id,archivo\n", { headers: { "Content-Disposition": 'attachment; filename="etiquetai-lecturas-20261103.csv"' } }),
    });

    const file = await readsApi.exportReads("csv", "t", { review: "corrected" });

    expect(file.filename).toBe("etiquetai-lecturas-20261103.csv");
    expect(Object.fromEntries(calls[0].query)).toEqual({ review_status: "corrected", format: "csv" });
    expect(await file.blob.text()).toBe("id,archivo\n");
  });
});

describe("images api", () => {
  it("accepts WebP and zips, and refuses the rest", () => {
    expect(imagesApi.validateImageFile(new File(["x"], "a.webp", { type: "image/webp" }))).toBeNull();
    expect(imagesApi.validateImageFile(new File(["x"], "a.gif", { type: "image/gif" }))).toMatch(/JPG, PNG o WebP/);
    expect(imagesApi.validateZipFile(new File(["x"], "lote.zip", { type: "" }))).toBeNull();
    expect(imagesApi.validateZipFile(new File(["x"], "lote.rar", { type: "application/x-rar" }))).toMatch(/\.zip/);
    expect(imagesApi.validateZipFile(new File([], "vacio.zip", { type: "application/zip" }))).toMatch(/vacío/);
  });

  it("reads the outcome of a zip upload", async () => {
    mockFetch({
      "POST /api/v1/images/batch": () =>
        json({ batch_id: "b-1", total: 3, accepted: [imagePayload({ batch_id: "b-1" })], rejected: [{ filename: "n.txt", reason: "not_an_image" }] }, 201),
    });

    const result = await imagesApi.uploadBatchZip(new File(["z"], "lote.zip"), "t");

    expect(result).toMatchObject({ batch_id: "b-1", total: 3 });
    expect(result.accepted[0].batch_id).toBe("b-1");
    expect(result.rejected).toEqual([{ filename: "n.txt", reason: "not_an_image" }]);
  });

  it("groups loose images under a batch id and can retry one or all", async () => {
    const { calls } = mockFetch({
      "POST /api/v1/images": () => json(imagePayload(), 201),
      "POST /api/v1/images/image-1/retry": () => json(imagePayload({ ocr_status: "queued" })),
      "POST /api/v1/images/retry-failed": () => json({ retried: 2, failed: 1, images: [imagePayload()] }),
    });

    await imagesApi.uploadImage(new File(["x"], "a.jpg", { type: "image/jpeg" }), "t", "batch-9");
    const retried = await imagesApi.retryImage("image-1", "t");
    const report = await imagesApi.retryFailedImages("t");

    expect((calls[0].body as FormData).get("batch_id")).toBe("batch-9");
    expect(retried.ocr_status).toBe("queued");
    expect(report).toMatchObject({ retried: 2, failed: 1 });
  });
});

describe("metrics api", () => {
  it("keeps a rate null instead of turning it into zero", () => {
    const summary = parseSummary({
      images: { total: 0, by_ocr_status: {} },
      reads: { total: 0, by_validation: {}, by_review: {}, reviewed: 0, corrected: 0, correction_rate: null, needs_attention_rate: null, corrected_by_field: {} },
      timing: { processed: 0, avg_seconds: null, images_per_minute: null },
    });

    expect(summary.reads.correctionRate).toBeNull();
    expect(summary.timing.avgSeconds).toBeNull();
  });

  it("refuses a malformed answer", () => {
    expect(() => parseSummary({ images: {} })).toThrow();
  });
});

describe("doubtful fields", () => {
  it("marks what the OCR flagged and what it read with little confidence", () => {
    const fields = doubtfulFields(["missing_tracking", "postal_code_mismatch", "implausible_destinatario"], { direccion: 0.3, destino: 0.95 });

    expect([...fields].sort()).toEqual(["codigo_postal", "destinatario", "direccion", "tracking"]);
  });
});
