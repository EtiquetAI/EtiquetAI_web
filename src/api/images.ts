import { authorizedRequest, isNonEmptyString, isRecord } from "./http.js";
import { parseOcrStatus, parseValidationStatus, type OcrStatus, type ValidationStatus } from "./vision.js";

export type ImageStatus = "pending" | "processed" | "failed";

export interface UploadedImage {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: ImageStatus;
  qr_content?: string;
  error_message?: string;
  created_at: string;
  /** Where the image is in the OCR pipeline. Absent when talking to an older API. */
  ocr_status?: OcrStatus;
  validation_status?: ValidationStatus;
  ocr_engine?: string;
  ocr_error?: string;
  ocr_completed_at?: string;
  /** Images that arrived together (one zip or one multi-file selection) share it. */
  batch_id?: string;
}

export interface BatchRejection {
  filename: string;
  reason: string;
}

export interface BatchUploadResult {
  batch_id: string;
  total: number;
  accepted: UploadedImage[];
  rejected: BatchRejection[];
}

export interface RetryReport {
  retried: number;
  failed: number;
  images: UploadedImage[];
}

const MAX_IDS_PER_REQUEST = 100;

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ZIP_TYPES = ["application/zip", "application/x-zip-compressed", "application/x-zip"];
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function isImageStatus(value: unknown): value is ImageStatus {
  return value === "pending" || value === "processed" || value === "failed";
}

function parseImage(payload: unknown): UploadedImage {
  if (
    !isRecord(payload) ||
    !isNonEmptyString(payload.id) ||
    !isNonEmptyString(payload.filename) ||
    !isNonEmptyString(payload.mime_type) ||
    !isImageStatus(payload.status) ||
    typeof payload.size_bytes !== "number" ||
    !isNonEmptyString(payload.created_at)
  ) {
    throw new Error("La API devolvió una respuesta inválida.");
  }

  const image: UploadedImage = {
    id: payload.id,
    filename: payload.filename,
    mime_type: payload.mime_type,
    size_bytes: payload.size_bytes,
    status: payload.status,
    created_at: payload.created_at,
  };

  if (isNonEmptyString(payload.qr_content)) {
    image.qr_content = payload.qr_content;
  }
  if (isNonEmptyString(payload.error_message)) {
    image.error_message = payload.error_message;
  }

  const ocrStatus = parseOcrStatus(payload.ocr_status);
  if (ocrStatus !== undefined) {
    image.ocr_status = ocrStatus;
  }
  const validationStatus = parseValidationStatus(payload.validation_status);
  if (validationStatus !== undefined) {
    image.validation_status = validationStatus;
  }
  if (isNonEmptyString(payload.ocr_engine)) {
    image.ocr_engine = payload.ocr_engine;
  }
  if (isNonEmptyString(payload.ocr_error)) {
    image.ocr_error = payload.ocr_error;
  }
  if (isNonEmptyString(payload.ocr_completed_at)) {
    image.ocr_completed_at = payload.ocr_completed_at;
  }
  if (isNonEmptyString(payload.batch_id)) {
    image.batch_id = payload.batch_id;
  }

  return image;
}

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Solo se aceptan imágenes JPG, PNG o WebP.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `La imagen supera el límite de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`;
  }
  if (file.size === 0) {
    return "El archivo está vacío.";
  }
  return null;
}

export function isZipFile(file: File): boolean {
  return ZIP_TYPES.includes(file.type) || file.name.toLowerCase().endsWith(".zip");
}

export function validateZipFile(file: File): string | null {
  if (!isZipFile(file)) {
    return "Solo se aceptan archivos .zip.";
  }
  if (file.size > MAX_ZIP_BYTES) {
    return `El zip supera el límite de ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB.`;
  }
  if (file.size === 0) {
    return "El archivo está vacío.";
  }
  return null;
}

export async function uploadImage(file: File, accessToken: string, batchId?: string): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);
  if (batchId) {
    form.append("batch_id", batchId);
  }

  const response = await authorizedRequest("/api/v1/images", accessToken, {
    method: "POST",
    body: form,
  });

  return parseImage(await response.json());
}

export async function listImages(accessToken: string): Promise<UploadedImage[]> {
  const response = await authorizedRequest("/api/v1/images", accessToken, { method: "GET" });
  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  return payload.map(parseImage);
}

/** Fetches only the given images, so a batch can be followed without listing the whole history. */
export async function listImagesByIDs(imageIDs: string[], accessToken: string): Promise<UploadedImage[]> {
  if (imageIDs.length === 0 || imageIDs.length > MAX_IDS_PER_REQUEST) return [];

  const wanted = new Set(imageIDs);
  const query = new URLSearchParams({ ids: imageIDs.join(",") });
  const response = await authorizedRequest(`/api/v1/images?${query.toString()}`, accessToken, { method: "GET" });
  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  return payload.map(parseImage).filter((image) => wanted.has(image.id));
}

function parseRejections(value: unknown): BatchRejection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) && isNonEmptyString(item.filename) && isNonEmptyString(item.reason)
      ? [{ filename: item.filename, reason: item.reason }]
      : [],
  );
}

/** Sends a zip: the server unpacks it, validates every entry and queues each image under one batch. */
export async function uploadBatchZip(file: File, accessToken: string): Promise<BatchUploadResult> {
  const form = new FormData();
  form.append("file", file);

  const response = await authorizedRequest("/api/v1/images/batch", accessToken, { method: "POST", body: form });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isNonEmptyString(payload.batch_id) || !Array.isArray(payload.accepted)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  return {
    batch_id: payload.batch_id,
    total: typeof payload.total === "number" ? payload.total : payload.accepted.length,
    accepted: payload.accepted.map(parseImage),
    rejected: parseRejections(payload.rejected),
  };
}

export async function retryImage(id: string, accessToken: string): Promise<UploadedImage> {
  const response = await authorizedRequest(`/api/v1/images/${encodeURIComponent(id)}/retry`, accessToken, { method: "POST" });
  return parseImage(await response.json());
}

export async function retryFailedImages(accessToken: string): Promise<RetryReport> {
  const response = await authorizedRequest("/api/v1/images/retry-failed", accessToken, { method: "POST" });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.images)) {
    throw new Error("La API devolvió una respuesta inválida.");
  }
  return {
    retried: typeof payload.retried === "number" ? payload.retried : payload.images.length,
    failed: typeof payload.failed === "number" ? payload.failed : 0,
    images: payload.images.map(parseImage),
  };
}

/**
 * The original upload as a blob URL. The route needs the bearer token, which an
 * `<img src>` cannot send, so the bytes are fetched and handed over as a blob.
 * The caller revokes the URL when it is done with it.
 */
export async function fetchImageObjectUrl(id: string, accessToken: string): Promise<string> {
  const response = await authorizedRequest(`/api/v1/images/${encodeURIComponent(id)}/file`, accessToken, {
    method: "GET",
    headers: { Accept: "image/*" },
  });
  return URL.createObjectURL(await response.blob());
}

export const imagesApi = {
  uploadImage,
  uploadBatchZip,
  retryImage,
  retryFailedImages,
  fetchImageObjectUrl,
  validateZipFile,
  isZipFile,
  listImages,
  listImagesByIDs,
  validateImageFile,
};
