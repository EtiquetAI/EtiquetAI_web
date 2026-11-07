import { test, expect } from "@playwright/test";
import type { UploadedImage } from "../../src/api/images.js";
import {
  isOcrSettled,
  parseConfidence,
  parseIssues,
  parseOcrStatus,
  parseValidationStatus,
} from "../../src/api/vision.js";
import { confidenceLevel, describeIssue, formatConfidence, orderedConfidence } from "../../src/results/status.js";
import { describeOcrState, mergeImage } from "../../src/upload/ocrState.js";

const base: UploadedImage = {
  id: "image-1", filename: "a.png", mime_type: "image/png", size_bytes: 1, status: "processed",
  created_at: "2026-01-01T00:00:00Z",
};

test("accepts only the statuses the API defines", () => {
  expect(parseValidationStatus("REVIEW")).toBe("REVIEW");
  expect(parseValidationStatus("review")).toBeUndefined();
  expect(parseValidationStatus(3)).toBeUndefined();
  expect(parseOcrStatus("not_queued")).toBe("not_queued");
  expect(parseOcrStatus("running")).toBeUndefined();
});

test("keeps only well-formed issues and confidence scores", () => {
  expect(parseIssues(["a", "", 3, null, "b"])).toEqual(["a", "b"]);
  expect(parseIssues("nope")).toEqual([]);
  expect(parseConfidence({ tracking: 0.5, bad: 7, worse: "x", nan: Number.NaN })).toEqual({ tracking: 0.5 });
  expect(parseConfidence([1, 2])).toEqual({});
  expect(parseConfidence(null)).toEqual({});
});

test("knows which OCR states can still change", () => {
  expect(isOcrSettled("queued")).toBe(false);
  expect(isOcrSettled(undefined)).toBe(false);
  for (const status of ["done", "failed", "not_queued", "disabled", "unknown"] as const) {
    expect(isOcrSettled(status)).toBe(true);
  }
});

test("explains every issue code the service emits, and passes unknown ones through", () => {
  const known = [
    "no_label_detected", "ocr_failed", "qr_without_text_fields", "qr_only", "postal_code_mismatch",
    "tracking_mismatch", "postal_code_format_invalid", "tracking_format_invalid", "tracking_corrected_from_qr",
    "tracking_from_qr", "postal_code_from_qr", "tracking_repaired", "missing_destinatario",
    "low_confidence_tracking",
  ];
  for (const code of known) {
    expect(describeIssue(code), code).not.toBe(code);
  }
  expect(describeIssue("missing_codigo_postal")).toBe("Falta el campo «Código postal».");
  expect(describeIssue("missing_something_new")).toBe("Falta el campo «something_new».");
  expect(describeIssue("brand_new_code")).toBe("brand_new_code");
});

test("grades and formats confidence", () => {
  expect(confidenceLevel(0.8)).toBe("high");
  expect(confidenceLevel(0.79)).toBe("medium");
  expect(confidenceLevel(0.5)).toBe("medium");
  expect(confidenceLevel(0.49)).toBe("low");
  expect(formatConfidence(0.916)).toBe("92%");
  expect(orderedConfidence({ zeta: 0.1, tracking: 0.2, destinatario: 0.3 }).map(([field]) => field)).toEqual([
    "destinatario", "tracking", "zeta",
  ]);
});

test("describes each stage of the OCR for the operator", () => {
  expect(describeOcrState(base)).toBeNull();
  expect(describeOcrState({ ...base, ocr_status: "unknown" })).toBeNull();
  expect(describeOcrState({ ...base, ocr_status: "queued" })).toMatchObject({ label: "Esperando OCR…", settled: false });
  expect(describeOcrState({ ...base, ocr_status: "done", validation_status: "OK" })).toMatchObject({ label: "Leída", tone: "success" });
  expect(describeOcrState({ ...base, ocr_status: "done", validation_status: "REVIEW" })).toMatchObject({ tone: "warning" });
  expect(describeOcrState({ ...base, ocr_status: "done", validation_status: "REJECTED" })).toMatchObject({ label: "Sin etiqueta legible" });
  expect(describeOcrState({ ...base, ocr_status: "done" })).toMatchObject({ label: "Leída" });
  expect(describeOcrState({ ...base, ocr_status: "failed", ocr_error: "boom" })).toMatchObject({ tone: "danger", detail: "boom" });
  expect(describeOcrState({ ...base, ocr_status: "not_queued" })?.detail).toContain("no llegó al OCR");
  expect(describeOcrState({ ...base, ocr_status: "disabled" })).toMatchObject({ settled: true });
});

test("a stale snapshot never takes an image back to waiting", () => {
  const finished: UploadedImage = { ...base, ocr_status: "done", validation_status: "OK" };
  const stale: UploadedImage = { ...base, ocr_status: "queued" };

  expect(mergeImage(finished, stale)).toBe(finished);
  expect(mergeImage(stale, finished)).toBe(finished);
  expect(mergeImage(undefined, stale)).toBe(stale);
  expect(mergeImage({ ...base, ocr_status: "queued" }, { ...base, ocr_status: "queued" }).ocr_status).toBe("queued");
});
