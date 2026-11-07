import type { ReviewStatus } from "../api/reads.js";
import type { ValidationStatus } from "../api/vision.js";

export type Tone = "success" | "warning" | "danger" | "neutral";

export interface StatusPresentation {
  label: string;
  description: string;
  tone: Tone;
}

export const STATUS_PRESENTATION: Record<ValidationStatus, StatusPresentation> = {
  OK: {
    label: "Correcta",
    description: "Los datos obligatorios se leyeron con buena confianza y no hay conflictos con el QR.",
    tone: "success",
  },
  REVIEW: {
    label: "Revisar",
    description: "Hay algo dudoso: conviene que una persona confirme los datos antes de usarlos.",
    tone: "warning",
  },
  REJECTED: {
    label: "Rechazada",
    description: "No se pudo leer una etiqueta de envío en esta imagen.",
    tone: "danger",
  },
};

export const REVIEW_PRESENTATION: Record<ReviewStatus, StatusPresentation> = {
  pending: { label: "Sin revisar", description: "Ninguna persona controló esta lectura todavía.", tone: "neutral" },
  confirmed: { label: "Confirmada", description: "Una persona controló la lectura y la aceptó tal como estaba.", tone: "success" },
  corrected: { label: "Corregida", description: "Una persona corrigió al menos un campo de la lectura automática.", tone: "warning" },
};

export const FIELD_LABELS: Record<string, string> = {
  destino: "Destino",
  codigo_postal: "Código postal",
  destinatario: "Destinatario",
  tracking: "Tracking",
  direccion: "Dirección",
};

const ISSUE_MESSAGES: Record<string, string> = {
  no_label_detected: "No se detectó una etiqueta de envío en la imagen.",
  ocr_failed: "El OCR no pudo procesar la imagen.",
  qr_without_text_fields: "Solo se pudo leer el código QR.",
  qr_only: "Solo se pudo leer el código QR; el OCR no encontró una etiqueta.",
  postal_code_mismatch: "El código postal leído no coincide con el del QR.",
  tracking_mismatch: "El tracking leído no coincide con el del QR.",
  postal_code_format_invalid: "El código postal no tiene un formato válido.",
  tracking_format_invalid: "El tracking no tiene el formato esperado.",
  tracking_corrected_from_qr: "El tracking se corrigió usando el QR.",
  tracking_from_qr: "El tracking se tomó del QR.",
  postal_code_from_qr: "El código postal se tomó del QR.",
  tracking_repaired: "Se repararon caracteres que el OCR había confundido en el tracking.",
  multiple_labels_detected: "La imagen tiene más de una etiqueta: abajo se listan todas.",
  implausible_destinatario: "El destinatario leído no parece un nombre: conviene revisarlo.",
  implausible_destino: "El destino leído no parece una localidad: conviene revisarlo.",
  implausible_direccion: "La dirección leída parece cortada o mezclada con otro campo.",
};

/** Why a zip entry was left out, in words an operator can act on. */
export const BATCH_REJECTION_MESSAGES: Record<string, string> = {
  not_an_image: "no es una imagen válida",
  unsupported_format: "formato no soportado",
  empty: "el archivo está vacío",
  file_too_large: "supera el tamaño máximo",
  encrypted: "está protegido con contraseña",
  unreadable: "no se pudo leer dentro del zip",
  archive_too_large: "el zip se expande demasiado",
  could_not_store: "no se pudo guardar",
};

export function describeRejection(reason: string): string {
  return BATCH_REJECTION_MESSAGES[reason] ?? reason;
}

/** Fields the OCR itself was unsure about, so the person looks at them first. */
export function doubtfulFields(issues: string[] | undefined, confidence: Record<string, number> | undefined): Set<string> {
  const doubtful = new Set<string>();
  for (const code of issues ?? []) {
    if (code.startsWith(MISSING_PREFIX)) doubtful.add(code.slice(MISSING_PREFIX.length));
    else if (code.startsWith(LOW_CONFIDENCE_PREFIX)) doubtful.add(code.slice(LOW_CONFIDENCE_PREFIX.length));
    else if (code.startsWith("implausible_")) doubtful.add(code.slice("implausible_".length));
    else if (code === "postal_code_mismatch" || code === "postal_code_format_invalid") doubtful.add("codigo_postal");
    else if (code === "tracking_mismatch" || code === "tracking_format_invalid") doubtful.add("tracking");
  }
  for (const [field, score] of Object.entries(confidence ?? {})) {
    if (score < MEDIUM_CONFIDENCE) doubtful.add(field);
  }
  return doubtful;
}

const MISSING_PREFIX = "missing_";
const LOW_CONFIDENCE_PREFIX = "low_confidence_";

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

export function describeIssue(code: string): string {
  const known = ISSUE_MESSAGES[code];
  if (known !== undefined) {
    return known;
  }
  if (code.startsWith(MISSING_PREFIX)) {
    return `Falta el campo «${fieldLabel(code.slice(MISSING_PREFIX.length))}».`;
  }
  if (code.startsWith(LOW_CONFIDENCE_PREFIX)) {
    return `La lectura de «${fieldLabel(code.slice(LOW_CONFIDENCE_PREFIX.length))}» tiene poca confianza.`;
  }
  return code;
}

export type ConfidenceLevel = "high" | "medium" | "low";

const HIGH_CONFIDENCE = 0.8;
const MEDIUM_CONFIDENCE = 0.5;

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= HIGH_CONFIDENCE) return "high";
  if (score >= MEDIUM_CONFIDENCE) return "medium";
  return "low";
}

export function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function orderedConfidence(confidence: Record<string, number>): Array<[string, number]> {
  const known = Object.keys(FIELD_LABELS).filter((field) => field in confidence);
  const extra = Object.keys(confidence).filter((field) => !(field in FIELD_LABELS)).sort();
  return [...known, ...extra].map((field) => [field, confidence[field]]);
}
