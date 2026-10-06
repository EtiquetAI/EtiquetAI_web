import { authorizedRequest, isNonEmptyString, isRecord } from "./http.js";

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
}

const ACCEPTED_TYPES = ["image/jpeg", "image/png"];
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

  return image;
}

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Solo se aceptan imágenes JPG o PNG.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `La imagen supera el límite de ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`;
  }
  if (file.size === 0) {
    return "El archivo está vacío.";
  }
  return null;
}

export async function uploadImage(file: File, accessToken: string): Promise<UploadedImage> {
  const form = new FormData();
  form.append("file", file);

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

export const imagesApi = {
  uploadImage,
  listImages,
  validateImageFile,
};
