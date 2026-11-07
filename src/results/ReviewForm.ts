import { ApiHttpError } from "../api/auth.js";
import { EDITABLE_FIELDS, readsApi, type EditableField, type LabelRead, type ReadChanges } from "../api/reads.js";
import { doubtfulFields, fieldLabel } from "./status.js";

export interface ReviewFormOptions {
  getAccessToken: () => string | null;
  /** Called with the read the server answered with, after a save or a confirmation. */
  onSaved: (read: LabelRead) => void;
  notify?: (message: string, tone: "neutral" | "error") => void;
}

const NO_VALUE = "";

function currentValue(row: LabelRead, field: EditableField): string {
  return row[field] ?? NO_VALUE;
}

export function describeSaveError(error: unknown): string {
  if (error instanceof ApiHttpError) {
    switch (error.code) {
      case "invalid_value":
        return "Algún valor es demasiado largo o tiene caracteres no permitidos.";
      case "nothing_to_update":
        return "No hay cambios para guardar.";
      case "unauthorized":
        return "Tu sesión expiró. Volvé a iniciar sesión.";
    }
    if (error.status === 404) return "La lectura ya no existe. Actualizá la tabla.";
    return `La API rechazó el cambio (HTTP ${error.status}).`;
  }
  return error instanceof Error ? error.message : "No se pudo guardar el cambio.";
}

/**
 * The person's side of the review: every field editable, the OCR's own value
 * always one click away, and the doubtful fields marked so the eye goes there.
 */
export function createReviewForm(row: LabelRead, options: ReviewFormOptions): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "review-form";
  form.noValidate = true;
  form.setAttribute("aria-label", "Corregir la lectura");

  const doubtful = doubtfulFields(row.issues, row.confidence);
  const inputs = new Map<EditableField, HTMLInputElement>();

  for (const field of EDITABLE_FIELDS) {
    const wrapper = document.createElement("div");
    wrapper.className = "review-field";
    const inputId = `review-${row.id}-${field}`;

    const label = document.createElement("label");
    label.htmlFor = inputId;
    label.textContent = fieldLabel(field);
    if (doubtful.has(field)) {
      wrapper.classList.add("is-doubtful");
      const flag = document.createElement("span");
      flag.className = "review-doubt";
      flag.textContent = "revisar";
      label.append(" ", flag);
    }

    const input = document.createElement("input");
    input.id = inputId;
    input.name = field;
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = field === "codigo_postal" ? 20 : 255;
    input.value = currentValue(row, field);
    input.dataset.original = input.value;
    inputs.set(field, input);

    wrapper.append(label, input);

    const correction = row.corrections?.[field];
    if (correction) {
      const hint = document.createElement("p");
      hint.className = "review-original";
      hint.append(`El OCR leyó: ${correction.original ?? "(nada)"} `);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "text-button review-restore";
      restore.textContent = "Restaurar";
      restore.addEventListener("click", () => {
        input.value = correction.original ?? NO_VALUE;
        refreshState();
        input.focus();
      });
      hint.appendChild(restore);
      wrapper.appendChild(hint);
    }
    form.appendChild(wrapper);
  }

  const actions = document.createElement("div");
  actions.className = "review-actions";

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "button button-primary button-compact review-save";
  save.textContent = "Guardar correcciones";

  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "button button-secondary button-compact review-confirm";
  confirm.textContent = row.review_status === "confirmed" ? "Confirmada" : "Confirmar lectura";

  const state = document.createElement("span");
  state.className = "review-state";
  state.setAttribute("role", "status");
  state.setAttribute("aria-live", "polite");

  actions.append(save, confirm, state);
  form.appendChild(actions);

  let busy = false;

  function changes(): ReadChanges {
    const changed: ReadChanges = {};
    for (const [field, input] of inputs) {
      if (input.value.trim() !== (input.dataset.original ?? NO_VALUE).trim()) {
        changed[field] = input.value.trim();
      }
    }
    return changed;
  }

  function refreshState(): void {
    const dirty = Object.keys(changes()).length > 0;
    save.disabled = busy || !dirty;
    confirm.disabled = busy || dirty || row.review_status === "confirmed";
    form.classList.toggle("is-dirty", dirty);
    if (!busy) state.textContent = dirty ? "Hay cambios sin guardar." : "";
  }

  async function send(payload: ReadChanges, doneMessage: string): Promise<void> {
    const token = options.getAccessToken();
    if (token === null || busy) return;
    busy = true;
    refreshState();
    state.textContent = "Guardando…";
    try {
      const updated = await readsApi.updateRead(row.id, payload, token);
      options.notify?.(doneMessage, "neutral");
      options.onSaved(updated);
    } catch (error) {
      busy = false;
      state.textContent = describeSaveError(error);
      options.notify?.(describeSaveError(error), "error");
      refreshState();
      state.textContent = describeSaveError(error);
    }
  }

  form.addEventListener("input", refreshState);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = changes();
    if (Object.keys(payload).length === 0) return;
    void send(payload, "Correcciones guardadas.");
  });
  confirm.addEventListener("click", () => void send({ confirm: true }, "Lectura confirmada."));

  refreshState();
  return form;
}
