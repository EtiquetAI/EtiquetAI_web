import { authorizedRequest, isNonEmptyString, isRecord } from "./http.js";
import {
  parseConfidence,
  parseIssues,
  parseValidationStatus,
  type ValidationStatus,
} from "./vision.js";

export type ReadSource = "camera" | "image";

export type ReviewStatus = "pending" | "confirmed" | "corrected";

/** One field a person changed: what the OCR had and what replaced it. */
export interface FieldCorrection {
  original: string | null;
  corrected: string | null;
  at?: string;
}

/** A label of a sheet beyond the first one. Read-only. */
export interface ExtraLabel {
  destino: string | null;
  codigo_postal: string | null;
  destinatario: string | null;
  tracking: string | null;
  direccion: string | null;
  qr_raw?: string;
  validation_status?: ValidationStatus;
  issues: string[];
}

export const EDITABLE_FIELDS = ["destinatario", "direccion", "codigo_postal", "destino", "tracking"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type ReadChanges = Partial<Record<EditableField, string>> & { confirm?: boolean };

export interface ReadFilter {
  validation?: ValidationStatus;
  review?: ReviewStatus;
  batchId?: string;
  query?: string;
}

export interface LabelRead {
  id: string;
  content: string;
  source: ReadSource;
  filename?: string;
  image_id?: string;
  /** Extracted by the OCR worker. `null` means it was not found, never guessed. */
  destino: string | null;
  codigo_postal: string | null;
  destinatario: string | null;
  tracking: string | null;
  created_at: string;
  /** Added with version 1 of the contract. Optional so an older API still parses. */
  direccion?: string | null;
  qr_raw?: string | null;
  qr_tracking?: string | null;
  qr_codigo_postal?: string | null;
  /** What to do with the reading. Absent for camera scans, which no OCR has judged. */
  validation_status?: ValidationStatus;
  issues?: string[];
  confidence?: Record<string, number>;
  engine?: string;
  ocr_text?: string;
  /** Human review. Absent against an API that predates it, which reads as pending. */
  review_status?: ReviewStatus;
  reviewed_at?: string;
  corrections?: Partial<Record<EditableField, FieldCorrection>>;
  /** More than 1 when the image held several labels; the fields describe the first. */
  label_count?: number;
  extra_labels?: ExtraLabel[];
}

function isReadSource(value: unknown): value is ReadSource {
  return value === "camera" || value === "image";
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function parseRead(payload: unknown): LabelRead {
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.id) ||
    !isNonEmptyString(payload.content) ||
    !isReadSource(payload.source) ||
    !isNonEmptyString(payload.created_at)
  ) {
    throw new Error("La API devolvió una respuesta inválida.");
  }

  const read: LabelRead = {
    id: payload.id,
    content: payload.content,
    source: payload.source,
    destino: optionalText(payload.destino),
    codigo_postal: optionalText(payload.codigo_postal),
    destinatario: optionalText(payload.destinatario),
    tracking: optionalText(payload.tracking),
    created_at: payload.created_at,
  };

  if (isNonEmptyString(payload.filename)) {
    read.filename = payload.filename;
  }
  if (isNonEmptyString(payload.image_id)) {
    read.image_id = payload.image_id;
  }

  read.direccion = optionalText(payload.direccion);
  read.qr_raw = optionalText(payload.qr_raw);
  read.qr_tracking = optionalText(payload.qr_tracking);
  read.qr_codigo_postal = optionalText(payload.qr_codigo_postal);
  read.issues = parseIssues(payload.issues);
  read.confidence = parseConfidence(payload.confidence);

  const validationStatus = parseValidationStatus(payload.validation_status);
  if (validationStatus !== undefined) {
    read.validation_status = validationStatus;
  }
  if (isNonEmptyString(payload.engine)) {
    read.engine = payload.engine;
  }
  if (isNonEmptyString(payload.ocr_text)) {
    read.ocr_text = payload.ocr_text;
  }

  read.review_status = parseReviewStatus(payload.review_status);
  if (isNonEmptyString(payload.reviewed_at)) {
    read.reviewed_at = payload.reviewed_at;
  }
  read.corrections = parseCorrections(payload.corrections);
  read.label_count = typeof payload.label_count === "number" && payload.label_count > 0 ? payload.label_count : 1;
  read.extra_labels = parseExtraLabels(payload.extra_labels);

  return read;
}

export function parseReviewStatus(value: unknown): ReviewStatus {
  return value === "confirmed" || value === "corrected" ? value : "pending";
}

function parseCorrections(value: unknown): Partial<Record<EditableField, FieldCorrection>> {
  const corrections: Partial<Record<EditableField, FieldCorrection>> = {};
  if (!isRecord(value)) return corrections;
  for (const field of EDITABLE_FIELDS) {
    const entry = value[field];
    if (!isRecord(entry)) continue;
    corrections[field] = {
      original: optionalText(entry.original),
      corrected: optionalText(entry.corrected),
      ...(isNonEmptyString(entry.at) ? { at: entry.at } : {}),
    };
  }
  return corrections;
}

function parseExtraLabels(value: unknown): ExtraLabel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    destino: optionalText(item.destino),
    codigo_postal: optionalText(item.codigo_postal),
    destinatario: optionalText(item.destinatario),
    tracking: optionalText(item.tracking),
    direccion: optionalText(item.direccion),
    ...(isNonEmptyString(item.qr_raw) ? { qr_raw: item.qr_raw } : {}),
    ...(parseValidationStatus(item.validation_status) ? { validation_status: parseValidationStatus(item.validation_status) } : {}),
    issues: parseIssues(item.issues),
  }));
}

/** The query string for a filter. Empty when nothing narrows the list, so an unfiltered request is the plain one. */
export function filterQuery(filter: ReadFilter | undefined): string {
  const params = new URLSearchParams();
  if (filter?.validation) params.set("validation_status", filter.validation);
  if (filter?.review) params.set("review_status", filter.review);
  if (filter?.batchId) params.set("batch_id", filter.batchId);
  if (filter?.query?.trim()) params.set("q", filter.query.trim());
  return params.toString();
}

export function isFilterActive(filter: ReadFilter | undefined): boolean {
  return filterQuery(filter) !== "";
}

export async function listReads(accessToken: string, filter?: ReadFilter): Promise<LabelRead[]> {
  const query = filterQuery(filter);
  const response = await authorizedRequest(`/api/v1/reads${query ? `?${query}` : ""}`, accessToken, { method: "GET" });
  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  return payload.map(parseRead);
}

export async function listReadsForImages(imageIDs: string[], accessToken: string): Promise<LabelRead[]> {
  if (imageIDs.length === 0 || imageIDs.length > 100) return [];
  const query = new URLSearchParams({ image_ids: imageIDs.join(",") });
  const response = await authorizedRequest(`/api/v1/reads?${query.toString()}`, accessToken, { method: "GET" });
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  return payload.map(parseRead);
}

export async function createRead(content: string, accessToken: string): Promise<LabelRead> {
  const response = await authorizedRequest("/api/v1/reads", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  return parseRead(await response.json());
}

/** A person corrects fields and/or confirms the read. An empty string clears a field. */
export async function updateRead(id: string, changes: ReadChanges, accessToken: string): Promise<LabelRead> {
  const response = await authorizedRequest(`/api/v1/reads/${encodeURIComponent(id)}`, accessToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  return parseRead(await response.json());
}

export interface ExportedFile {
  blob: Blob;
  filename: string;
}

/** The server builds the file, so CSV and JSON carry the same fields the API holds. */
export async function exportReads(format: "csv" | "json", accessToken: string, filter?: ReadFilter): Promise<ExportedFile> {
  const params = new URLSearchParams(filterQuery(filter));
  params.set("format", format);
  const response = await authorizedRequest(`/api/v1/reads/export?${params.toString()}`, accessToken, {
    method: "GET",
    headers: { Accept: format === "csv" ? "text/csv" : "application/json" },
  });
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const named = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return { blob: await response.blob(), filename: named ?? `etiquetai-lecturas.${format}` };
}

export async function deleteRead(id: string, accessToken: string): Promise<void> {
  await authorizedRequest(`/api/v1/reads/${encodeURIComponent(id)}`, accessToken, { method: "DELETE" });
}

export async function deleteAllReads(accessToken: string): Promise<void> {
  await authorizedRequest("/api/v1/reads", accessToken, { method: "DELETE" });
}

export const readsApi = {
  listReads,
  listReadsForImages,
  createRead,
  updateRead,
  exportReads,
  deleteRead,
  deleteAllReads,
};
