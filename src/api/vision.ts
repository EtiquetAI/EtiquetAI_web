export type ValidationStatus = "OK" | "REVIEW" | "REJECTED";

export type OcrStatus = "unknown" | "disabled" | "queued" | "not_queued" | "done" | "failed";

const VALIDATION_STATUSES: readonly ValidationStatus[] = ["OK", "REVIEW", "REJECTED"];
const OCR_STATUSES: readonly OcrStatus[] = ["unknown", "disabled", "queued", "not_queued", "done", "failed"];
const SETTLED_OCR_STATUSES: readonly OcrStatus[] = ["unknown", "disabled", "not_queued", "done", "failed"];

export function parseValidationStatus(value: unknown): ValidationStatus | undefined {
  return VALIDATION_STATUSES.find((status) => status === value);
}

export function parseOcrStatus(value: unknown): OcrStatus | undefined {
  return OCR_STATUSES.find((status) => status === value);
}

export function parseIssues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

export function parseConfidence(value: unknown): Record<string, number> {
  const confidence: Record<string, number> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return confidence;
  }
  for (const [field, score] of Object.entries(value)) {
    if (typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1) {
      confidence[field] = score;
    }
  }
  return confidence;
}

/** An image whose OCR will not change any more, whatever the outcome was. */
export function isOcrSettled(status: OcrStatus | undefined): boolean {
  return status !== undefined && SETTLED_OCR_STATUSES.includes(status);
}
