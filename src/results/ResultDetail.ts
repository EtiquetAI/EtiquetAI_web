import type { EditableField, ExtraLabel, LabelRead } from "../api/reads.js";
import { loadImageUrl } from "./ImageCache.js";
import { createReviewForm } from "./ReviewForm.js";
import { createStatusBadge } from "./StatusBadge.js";
import {
  REVIEW_PRESENTATION,
  confidenceLevel,
  describeIssue,
  fieldLabel,
  formatConfidence,
  issueField,
  orderedConfidence,
} from "./status.js";

export interface DetailOptions {
  getAccessToken: () => string | null;
  onSaved: (read: LabelRead) => void;
  notify?: (message: string, tone: "neutral" | "error") => void;
}

/**
 * Without `options` the detail is read-only. With them, an image read also
 * shows the original picture next to an editable form, so a person can compare
 * the label with what was read and fix it in place.
 */
export function createResultDetail(row: LabelRead, options?: DetailOptions): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "result-detail";

  if (options !== undefined && row.source === "image") {
    detail.appendChild(reviewSection(row, options));
  }

  const extras = row.extra_labels ?? [];
  if ((row.label_count ?? 1) > 1) {
    detail.appendChild(section(`Etiquetas en la imagen (${row.label_count})`, extraLabelList(row, extras), true));
  }

  const corrections = Object.entries(row.corrections ?? {});
  if (corrections.length > 0) {
    detail.appendChild(
      section("Correcciones", correctionList(corrections as Array<[EditableField, { original: string | null; corrected: string | null }]>), true),
    );
  }

  const issues = row.issues ?? [];
  if (issues.length > 0) {
    detail.appendChild(section("Motivos", issueList(issues, row.id, options !== undefined && row.source === "image")));
  } else if (row.validation_status === "OK") {
    detail.appendChild(section("Motivos", paragraph("Sin observaciones.")));
  }

  const confidence = orderedConfidence(row.confidence ?? {});
  if (confidence.length > 0) {
    detail.appendChild(section("Confianza de lectura", confidenceList(confidence)));
  }

  const qr = qrSummary(row);
  if (qr.length > 0) {
    detail.appendChild(section("Código QR", definitionList(qr)));
  }

  const origin: Array<[string, string]> = [];
  if (row.engine) origin.push(["Motor OCR", row.engine]);
  if (row.filename) origin.push(["Archivo", row.filename]);
  if (origin.length > 0) {
    detail.appendChild(section("Origen", definitionList(origin)));
  }

  if (row.ocr_text) {
    detail.appendChild(section("Texto leído", rawText(row.ocr_text)));
  }

  if (detail.childElementCount === 0) {
    detail.appendChild(paragraph("No hay más detalles para este resultado."));
  }
  return detail;
}

export function hasDetail(row: LabelRead): boolean {
  return (
    row.source === "image" ||
    (row.label_count ?? 1) > 1 ||
    (row.issues?.length ?? 0) > 0 ||
    Object.keys(row.confidence ?? {}).length > 0 ||
    row.validation_status !== undefined ||
    Boolean(row.qr_raw) ||
    Boolean(row.ocr_text)
  );
}

function qrSummary(row: LabelRead): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (row.qr_raw) entries.push(["Contenido", row.qr_raw]);
  if (row.qr_tracking) entries.push([fieldLabel("tracking"), row.qr_tracking]);
  if (row.qr_codigo_postal) entries.push([fieldLabel("codigo_postal"), row.qr_codigo_postal]);
  return entries;
}

/** `wide` sections take the whole width of the detail instead of one narrow column of its grid. */
function section(title: string, body: HTMLElement, wide = false): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = wide ? "result-detail-section is-wide" : "result-detail-section";
  const heading = document.createElement("h4");
  heading.className = "result-detail-title";
  heading.textContent = title;
  wrapper.append(heading, body);
  return wrapper;
}

function paragraph(text: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "result-detail-text";
  element.textContent = text;
  return element;
}

/**
 * Each reason that is about one field takes the person to it: the reasons are what they
 * have to act on, so a click on "Falta el tracking" puts the cursor in the tracking field.
 */
function issueList(issues: string[], rowId: string, linkToFields: boolean): HTMLElement {
  const list = document.createElement("ul");
  list.className = "result-detail-list";
  for (const code of issues) {
    const item = document.createElement("li");
    item.dataset.issue = code;
    const field = issueField(code);
    if (linkToFields && field !== null) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "issue-link";
      link.textContent = describeIssue(code);
      link.title = `Ir al campo ${fieldLabel(field)}`;
      link.addEventListener("click", () => focusReviewField(rowId, field));
      item.appendChild(link);
    } else {
      item.textContent = describeIssue(code);
    }
    list.appendChild(item);
  }
  return list;
}

function focusReviewField(rowId: string, field: string): void {
  const input = document.getElementById(`review-${rowId}-${field}`);
  if (!(input instanceof HTMLInputElement)) return;
  input.focus();
  input.select();
  input.scrollIntoView?.({ block: "center", behavior: "smooth" });
  const wrapper = input.closest(".review-field");
  wrapper?.classList.add("is-flash");
  window.setTimeout(() => wrapper?.classList.remove("is-flash"), 1500);
}

function confidenceList(entries: Array<[string, number]>): HTMLElement {
  const list = document.createElement("ul");
  list.className = "result-detail-list is-confidence";
  for (const [field, score] of entries) {
    const item = document.createElement("li");
    item.className = `confidence-item is-${confidenceLevel(score)}`;

    const name = document.createElement("span");
    name.textContent = fieldLabel(field);

    const value = document.createElement("span");
    value.className = "confidence-value";
    value.textContent = formatConfidence(score);

    item.append(name, value);
    list.appendChild(item);
  }
  return list;
}

function definitionList(entries: Array<[string, string]>): HTMLElement {
  const list = document.createElement("dl");
  list.className = "result-detail-definitions";
  for (const [term, description] of entries) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = description;
    list.append(dt, dd);
  }
  return list;
}

function rawText(text: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "result-detail-raw";
  pre.textContent = text;
  return pre;
}

function reviewSection(row: LabelRead, options: DetailOptions): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "result-detail-section review-section is-wide";

  const heading = document.createElement("h4");
  heading.className = "result-detail-title";
  heading.textContent = "Revisión";
  const review = REVIEW_PRESENTATION[row.review_status ?? "pending"];
  const badge = document.createElement("span");
  badge.className = `review-badge is-${review.tone}`;
  badge.dataset.review = row.review_status ?? "pending";
  badge.textContent = review.label;
  badge.title = review.description;
  heading.append(" ", badge);

  const layout = document.createElement("div");
  layout.className = "review-layout";
  layout.append(imagePreview(row, options), createReviewForm(row, options));

  wrapper.append(heading, layout);
  return wrapper;
}

function imagePreview(row: LabelRead, options: DetailOptions): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "review-image";
  const caption = document.createElement("figcaption");
  caption.textContent = row.filename ?? "Imagen original";

  const token = options.getAccessToken();
  if (!row.image_id || token === null) {
    caption.textContent = "No hay imagen original para mostrar.";
    figure.appendChild(caption);
    return figure;
  }

  const status = document.createElement("p");
  status.className = "review-image-status";
  status.textContent = "Cargando imagen…";
  figure.append(status, caption);

  loadImageUrl(row.image_id, token).then(
    (url) => {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `Imagen original de ${row.filename ?? "la etiqueta"}`;
      image.loading = "lazy";
      status.replaceWith(image);
    },
    () => {
      status.textContent = "No se pudo cargar la imagen original.";
      status.classList.add("is-error");
    },
  );
  return figure;
}

function extraLabelList(row: LabelRead, extras: ExtraLabel[]): HTMLElement {
  const list = document.createElement("ol");
  list.className = "label-list";

  const first = document.createElement("li");
  first.className = "label-list-item is-main";
  first.append(labelSummary("Etiqueta 1 (la de la tabla)", row.destinatario, row.direccion, row.codigo_postal, row.destino, row.tracking), createStatusBadge(row.validation_status));
  list.appendChild(first);

  extras.forEach((extra, index) => {
    const item = document.createElement("li");
    item.className = "label-list-item";
    item.append(
      labelSummary(`Etiqueta ${index + 2}`, extra.destinatario, extra.direccion, extra.codigo_postal, extra.destino, extra.tracking),
      createStatusBadge(extra.validation_status),
    );
    list.appendChild(item);
  });
  return list;
}

function labelSummary(
  title: string,
  destinatario: string | null | undefined,
  direccion: string | null | undefined,
  codigoPostal: string | null | undefined,
  destino: string | null | undefined,
  tracking: string | null | undefined,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "label-summary";
  const name = document.createElement("strong");
  name.textContent = title;
  const text = document.createElement("span");
  const place = [codigoPostal, destino].filter(Boolean).join(" ");
  text.textContent = [destinatario, direccion, place, tracking].filter(Boolean).join(" · ") || "Sin datos legibles";
  block.append(name, text);
  return block;
}

function correctionList(entries: Array<[EditableField, { original: string | null; corrected: string | null }]>): HTMLElement {
  const list = document.createElement("ul");
  list.className = "result-detail-list is-corrections";
  for (const [field, correction] of entries) {
    const item = document.createElement("li");
    item.dataset.field = field;
    item.textContent = `${fieldLabel(field)}: «${correction.original ?? "(vacío)"}» → «${correction.corrected ?? "(vacío)"}»`;
    list.appendChild(item);
  }
  return list;
}
