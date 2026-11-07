import type { UploadedImage } from "../api/images.js";
import { isOcrSettled } from "../api/vision.js";
import type { Tone } from "../results/status.js";

export interface OcrStateView {
  label: string;
  tone: Tone;
  settled: boolean;
  detail?: string;
}

/** How the OCR pipeline treated an image, in words an operator can act on. `null` when the API does not say. */
export function describeOcrState(image: UploadedImage): OcrStateView | null {
  switch (image.ocr_status) {
    case undefined:
    case "unknown":
      return null;
    case "disabled":
      return { label: "OCR desactivado", tone: "neutral", settled: true };
    case "queued":
      return { label: "Esperando OCR…", tone: "neutral", settled: false };
    case "not_queued":
      return {
        label: "No se pudo encolar",
        tone: "danger",
        settled: true,
        detail: image.ocr_error ?? "La imagen se guardó pero no llegó al OCR.",
      };
    case "failed":
      return {
        label: "El OCR falló",
        tone: "danger",
        settled: true,
        detail: image.ocr_error,
      };
    case "done":
      return describeFinished(image);
  }
}

function describeFinished(image: UploadedImage): OcrStateView {
  switch (image.validation_status) {
    case "OK":
      return { label: "Leída", tone: "success", settled: true };
    case "REVIEW":
      return { label: "Leída · revisar", tone: "warning", settled: true };
    case "REJECTED":
      return { label: "Sin etiqueta legible", tone: "danger", settled: true };
    default:
      return { label: "Leída", tone: "success", settled: true };
  }
}

/**
 * Picks which copy of an image to keep when two snapshots race, for example the
 * list fetched after an upload and a poll that already saw the OCR finish. An
 * image never goes back from a finished OCR state to a waiting one.
 */
export function mergeImage(previous: UploadedImage | undefined, incoming: UploadedImage): UploadedImage {
  if (previous && isOcrSettled(previous.ocr_status) && !isOcrSettled(incoming.ocr_status)) {
    return previous;
  }
  return incoming;
}

export function isWaitingForOcr(image: UploadedImage): boolean {
  return image.ocr_status === "queued";
}
