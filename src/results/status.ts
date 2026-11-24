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
  engines_disagree_destinatario: "Los dos motores de OCR leyeron un destinatario distinto: conviene revisarlo.",
  engines_disagree_direccion: "Los dos motores de OCR leyeron una dirección distinta: conviene revisarla.",
  engines_disagree_codigo_postal: "Los dos motores de OCR leyeron un código postal distinto: conviene revisarlo.",
  engines_disagree_destino: "Los dos motores de OCR leyeron un destino distinto: conviene revisarlo.",
  engines_disagree_tracking: "Los dos motores de OCR leyeron un tracking distinto: conviene revisarlo.",
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

/** The field an issue is about, so a person can be taken to it; null when it concerns the whole reading. */
export function issueField(code: string): string | null {
  if (code.startsWith(MISSING_PREFIX)) return code.slice(MISSING_PREFIX.length);
  if (code.startsWith(LOW_CONFIDENCE_PREFIX)) return code.slice(LOW_CONFIDENCE_PREFIX.length);
  if (code.startsWith("implausible_")) return code.slice("implausible_".length);
  if (code.startsWith("engines_disagree_")) return code.slice("engines_disagree_".length);
  if (code === "postal_code_mismatch" || code === "postal_code_format_invalid") return "codigo_postal";
  if (code === "tracking_mismatch" || code === "tracking_format_invalid") return "tracking";
  return null;
}

/** Fields the OCR itself was unsure about, so the person looks at them first. */
export function doubtfulFields(issues: string[] | undefined, confidence: Record<string, number> | undefined): Set<string> {
  const doubtful = new Set<string>();
  for (const code of issues ?? []) {
    const field = issueField(code);
    if (field !== null) doubtful.add(field);
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
