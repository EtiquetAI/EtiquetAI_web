import { authorizedRequest, isNonEmptyString, isRecord } from "./http.js";

export type ReadSource = "camera" | "image";

export interface LabelRead {
  id: string;
  content: string;
  source: ReadSource;
  filename?: string;
  image_id?: string;
  created_at: string;
}

function isReadSource(value: unknown): value is ReadSource {
  return value === "camera" || value === "image";
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

export async function createRead(content: string, accessToken: string): Promise<LabelRead> {
  const response = await authorizedRequest("/api/v1/reads", accessToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  return parseRead(await response.json());
}

export const readsApi = {
  listReads,
  createRead,
};
