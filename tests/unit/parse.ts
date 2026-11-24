import type { LabelRead } from "../../src/api/reads.js";

/** A read shaped like the API's answer, without a round trip through fetch. */
export function parseImageForTest(payload: Record<string, unknown>): LabelRead {
  return {
    id: String(payload.id),
    content: String(payload.content),
    source: payload.source === "camera" ? "camera" : "image",
    destino: (payload.destino as string | null) ?? null,
    codigo_postal: (payload.codigo_postal as string | null) ?? null,
    destinatario: (payload.destinatario as string | null) ?? null,
    tracking: (payload.tracking as string | null) ?? null,
    direccion: (payload.direccion as string | null) ?? null,
    filename: payload.filename as string | undefined,
    image_id: payload.image_id as string | undefined,
    validation_status: payload.validation_status as LabelRead["validation_status"],
    review_status: (payload.review_status as LabelRead["review_status"]) ?? "pending",
    created_at: String(payload.created_at),
  };
}
