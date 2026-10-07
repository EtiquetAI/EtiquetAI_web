import { authorizedRequest, isNonEmptyString, isRecord } from "./http.js";

export type ReadSource = "camera" | "image";

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

  return read;
}

export async function listReads(accessToken: string): Promise<LabelRead[]> {
  const response = await authorizedRequest("/api/v1/reads", accessToken, { method: "GET" });
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
  deleteRead,
  deleteAllReads,
};
