import type { ValidationStatus } from "../api/vision.js";
import { STATUS_PRESENTATION } from "./status.js";

export function createStatusBadge(status: ValidationStatus | undefined): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "status-badge";

  if (status === undefined) {
    badge.classList.add("is-none");
    badge.textContent = "—";
    return badge;
  }

  const presentation = STATUS_PRESENTATION[status];
  badge.classList.add(`is-${presentation.tone}`);
  badge.dataset.status = status;
  badge.textContent = presentation.label;
  badge.title = presentation.description;
  return badge;
}
