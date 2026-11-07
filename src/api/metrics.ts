import { authorizedRequest, isRecord } from "./http.js";

export interface MetricsSummary {
  images: { total: number; byOcrStatus: Record<string, number> };
  reads: {
    total: number;
    byValidation: Record<string, number>;
    byReview: Record<string, number>;
    reviewed: number;
    corrected: number;
    /** Corrected over reviewed. `null` until a person has reviewed something. */
    correctionRate: number | null;
    /** Reads the OCR itself sent to a person (REVIEW or REJECTED). */
    needsAttentionRate: number | null;
    correctedByField: Record<string, number>;
  };
  timing: { processed: number; avgSeconds: number | null; imagesPerMinute: number | null };
}

function counts(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(value)) return out;
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isFinite(count)) out[key] = count;
  }
  return out;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseSummary(payload: unknown): MetricsSummary {
  if (!isRecord(payload) || !isRecord(payload.images) || !isRecord(payload.reads) || !isRecord(payload.timing)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  const { images, reads, timing } = payload;
  return {
    images: { total: number(images.total), byOcrStatus: counts(images.by_ocr_status) },
    reads: {
      total: number(reads.total),
      byValidation: counts(reads.by_validation),
      byReview: counts(reads.by_review),
      reviewed: number(reads.reviewed),
      corrected: number(reads.corrected),
      correctionRate: rate(reads.correction_rate),
      needsAttentionRate: rate(reads.needs_attention_rate),
      correctedByField: counts(reads.corrected_by_field),
    },
    timing: {
      processed: number(timing.processed),
      avgSeconds: rate(timing.avg_seconds),
      imagesPerMinute: rate(timing.images_per_minute),
    },
  };
}

export async function getMetricsSummary(accessToken: string, since?: string): Promise<MetricsSummary> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const response = await authorizedRequest(`/api/v1/metrics/summary${query}`, accessToken, { method: "GET" });
  return parseSummary(await response.json());
}

export const metricsApi = { getMetricsSummary };
