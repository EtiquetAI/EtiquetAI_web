import { isFilterActive, readsApi, type LabelRead, type ReadFilter, type ReviewStatus } from "../api/reads.js";
import type { ValidationStatus } from "../api/vision.js";
import { downloadBlob } from "../export/download.js";
import { downloadWorkbook, sheetBytes, type SheetColumn } from "../export/xlsx.js";
import { createResultDetail, hasDetail } from "./ResultDetail.js";
import { createStatusBadge } from "./StatusBadge.js";
import { REVIEW_PRESENTATION, STATUS_PRESENTATION, describeIssue } from "./status.js";

const QUERY_DEBOUNCE_MS = 300;

export interface BatchOption {
  id: string;
  label: string;
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export class ResultsTable {
  private readonly body: HTMLTableSectionElement;
  private readonly status: HTMLElement;
  private readonly count: HTMLElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly csvButton: HTMLButtonElement;
  private readonly jsonButton: HTMLButtonElement;
  private readonly validationFilter: HTMLSelectElement;
  private readonly reviewFilter: HTMLSelectElement;
  private readonly batchFilter: HTMLSelectElement;
  private readonly queryFilter: HTMLInputElement;
  private readonly clearFilters: HTMLButtonElement;
  private filter: ReadFilter = {};
  private queryTimer: number | undefined;
  private exporting = false;
  private readonly getAccessToken: () => string | null;
  private readonly onCleared?: () => void;
  private rows: LabelRead[] = [];
  private readonly expanded = new Set<string>();
  private loading = false;
  private mutating = false;

  constructor(options: { getAccessToken: () => string | null; onCleared?: () => void }) {
    this.getAccessToken = options.getAccessToken;
    this.onCleared = options.onCleared;
    window.addEventListener("resize", () => this.syncDetailWidth());
    this.body = this.require("resultsTableBody") as HTMLTableSectionElement;
    this.status = this.require("resultsTableStatus");
    this.count = this.require("resultsCount");
    this.exportButton = this.require("exportXlsxButton") as HTMLButtonElement;
    this.refreshButton = this.require("refreshResultsButton") as HTMLButtonElement;
    this.clearButton = this.require("clearResultsButton") as HTMLButtonElement;
    this.csvButton = this.require("exportCsvButton") as HTMLButtonElement;
    this.jsonButton = this.require("exportJsonButton") as HTMLButtonElement;
    this.validationFilter = this.require("resultsFilterValidation") as HTMLSelectElement;
    this.reviewFilter = this.require("resultsFilterReview") as HTMLSelectElement;
    this.batchFilter = this.require("resultsFilterBatch") as HTMLSelectElement;
    this.queryFilter = this.require("resultsFilterQuery") as HTMLInputElement;
    this.clearFilters = this.require("resultsFilterClear") as HTMLButtonElement;

    this.refreshButton.addEventListener("click", () => void this.refresh());
    this.exportButton.addEventListener("click", () => this.export());
    this.clearButton.addEventListener("click", () => void this.clear());
    this.csvButton.addEventListener("click", () => void this.exportFromServer("csv"));
    this.jsonButton.addEventListener("click", () => void this.exportFromServer("json"));

    this.validationFilter.addEventListener("change", () => this.applyFilters());
    this.reviewFilter.addEventListener("change", () => this.applyFilters());
    this.batchFilter.addEventListener("change", () => this.applyFilters());
    this.queryFilter.addEventListener("input", () => {
      window.clearTimeout(this.queryTimer);
      this.queryTimer = window.setTimeout(() => this.applyFilters(), QUERY_DEBOUNCE_MS);
    });
    this.clearFilters.addEventListener("click", () => {
      this.validationFilter.value = "";
      this.reviewFilter.value = "";
      this.batchFilter.value = "";
      this.queryFilter.value = "";
      this.applyFilters();
    });
    this.render();
  }

  /** The lots the batch filter offers: one per upload that carried a batch id. */
  setBatches(batches: BatchOption[]): void {
    const selected = this.batchFilter.value;
    const options = [new Option("Todos los lotes", "")];
    for (const batch of batches) options.push(new Option(batch.label, batch.id));
    this.batchFilter.replaceChildren(...options);
    this.batchFilter.value = batches.some((batch) => batch.id === selected) ? selected : "";
  }

  private applyFilters(): void {
    const validation = this.validationFilter.value as ValidationStatus | "";
    const review = this.reviewFilter.value as ReviewStatus | "";
    this.filter = {
      ...(validation ? { validation } : {}),
      ...(review ? { review } : {}),
      ...(this.batchFilter.value ? { batchId: this.batchFilter.value } : {}),
      ...(this.queryFilter.value.trim() ? { query: this.queryFilter.value.trim() } : {}),
    };
    this.clearFilters.hidden = !isFilterActive(this.filter);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const token = this.getAccessToken();
    if (token === null || this.loading) {
      return;
    }

    this.loading = true;
    this.refreshButton.disabled = true;
    this.setStatus("Consultando la base de datos…", "neutral");

    try {
      this.rows = await readsApi.listReads(token, this.filter);
      this.render();
      if (this.rows.length === 0 && isFilterActive(this.filter)) {
        this.setStatus("Ninguna lectura coincide con los filtros.", "neutral");
      } else if (this.rows.length === 0) {
        this.setStatus("Todavía no hay etiquetas guardadas. Escaneá un código o subí una imagen.", "neutral");
      } else {
        this.setStatus("", "neutral");
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "No se pudieron cargar los resultados.", "error");
    } finally {
      this.loading = false;
      this.refreshButton.disabled = this.mutating;
    }
  }

  /** Folds reads that arrived while a batch moves through the OCR queue into the table. */
  mergeReads(updates: LabelRead[]): void {
    if (updates.length === 0) return;

    const byID = new Map(this.rows.map((row) => [row.id, row]));
    for (const update of updates) {
      // A read that does not meet the active filters stays out of the table.
      if (matchesFilter(update, this.filter)) byID.set(update.id, update);
      else byID.delete(update.id);
    }
    this.rows = Array.from(byID.values()).sort(
      (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
    );
    this.render();
  }

  notify(message: string, tone: "neutral" | "error"): void {
    this.setStatus(message, tone);
  }

  private render(): void {
    this.body.replaceChildren();
    this.count.textContent = `${this.rows.length} ${this.rows.length === 1 ? "etiqueta" : "etiquetas"}`;
    this.refreshButton.disabled = this.loading || this.mutating;
    this.exportButton.disabled = this.rows.length === 0 || this.mutating;
    this.csvButton.disabled = this.exporting || this.mutating;
    this.jsonButton.disabled = this.exporting || this.mutating;
    this.clearButton.disabled = this.rows.length === 0 || this.mutating;

    if (this.rows.length === 0) {
      const empty = document.createElement("tr");
      empty.className = "table-empty";
      const cell = document.createElement("td");
      cell.colSpan = this.columnCount();
      cell.textContent = "La tabla está vacía.";
      empty.appendChild(cell);
      this.body.appendChild(empty);
      return;
    }

    const columns = this.columnCount();
    this.rows.forEach((row, index) => {
      this.body.appendChild(this.renderRow(row, index));
      if (this.expanded.has(row.id)) {
        this.body.appendChild(this.renderDetailRow(row, columns));
      }
    });
    this.syncDetailWidth();
  }

  /**
   * The table scrolls sideways but an open detail panel should stay in view, so
   * it is as wide as the visible area and pinned to its left edge.
   */
  private syncDetailWidth(): void {
    const scroller = this.body.closest<HTMLElement>(".table-scroll");
    if (!scroller) return;
    scroller.style.setProperty("--detail-width", `${scroller.clientWidth}px`);
  }

  private columnCount(): number {
    return Number(this.body.closest("table")?.querySelectorAll("thead th").length ?? 12);
  }

  private renderDetailRow(row: LabelRead, columns: number): HTMLTableRowElement {
    const tr = document.createElement("tr");
    tr.className = "result-detail-row";
    const td = document.createElement("td");
    td.colSpan = columns;
    td.appendChild(
      createResultDetail(row, {
        getAccessToken: this.getAccessToken,
        onSaved: (updated) => this.replaceRow(updated),
        notify: (message, tone) => this.setStatus(message, tone),
      }),
    );
    tr.appendChild(td);
    return tr;
  }

  private renderRow(row: LabelRead, index: number): HTMLTableRowElement {
    const tr = document.createElement("tr");

    tr.appendChild(cell("col-index", String(index + 1)));
    tr.appendChild(cell("col-date", safeDate(row.created_at)));

    const statusCell = document.createElement("td");
    statusCell.className = "col-status";
    statusCell.appendChild(createStatusBadge(row.validation_status));
    tr.appendChild(statusCell);

    const reviewCell = document.createElement("td");
    reviewCell.className = "col-review";
    reviewCell.appendChild(createReviewBadge(row.review_status));
    tr.appendChild(reviewCell);

    tr.appendChild(cell("col-destino", row.destino ?? "—"));
    tr.appendChild(cell("col-cp", row.codigo_postal ?? "—"));
    tr.appendChild(cell("col-destinatario", row.destinatario ?? "—"));
    tr.appendChild(cell("col-direccion", row.direccion ?? "—", row.direccion ?? undefined));
    tr.appendChild(cell("col-tracking", row.tracking ?? "—"));
    tr.appendChild(cell("col-content", row.content, row.content));

    const sourceCell = document.createElement("td");
    sourceCell.className = "col-source";
    const badge = document.createElement("span");
    badge.className = `source-badge is-${row.source}`;
    badge.textContent = row.source === "image" ? "Imagen" : "Cámara";
    sourceCell.appendChild(badge);
    tr.appendChild(sourceCell);

    tr.appendChild(cell("col-file", row.filename ?? "—", row.filename));

    const actions = document.createElement("td");
    actions.className = "col-actions";
    if (hasDetail(row)) {
      actions.appendChild(this.renderDetailButton(row, index));
    }
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "text-button result-delete-button";
    removeButton.textContent = "Borrar";
    removeButton.setAttribute("aria-label", `Borrar resultado ${index + 1}`);
    removeButton.disabled = this.mutating;
    removeButton.addEventListener("click", () => void this.remove(row));
    actions.appendChild(removeButton);
    tr.appendChild(actions);
    return tr;
  }

  /** Puts the read the server answered with in place of the one on screen. */
  private replaceRow(updated: LabelRead): void {
    this.rows = this.rows.map((row) => (row.id === updated.id ? updated : row));
    this.render();
  }

  private async exportFromServer(format: "csv" | "json"): Promise<void> {
    const token = this.getAccessToken();
    if (!token || this.exporting) return;
    this.exporting = true;
    this.render();
    try {
      const file = await readsApi.exportReads(format, token, this.filter);
      downloadBlob(file.filename, file.blob);
      this.setStatus(`Archivo ${format.toUpperCase()} descargado.`, "neutral");
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "No se pudo generar el archivo.", "error");
    } finally {
      this.exporting = false;
      this.render();
    }
  }

  private renderDetailButton(row: LabelRead, index: number): HTMLButtonElement {
    const isOpen = this.expanded.has(row.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button result-detail-button";
    button.textContent = isOpen ? "Ocultar" : "Detalle";
    button.setAttribute("aria-expanded", String(isOpen));
    button.setAttribute("aria-label", `${isOpen ? "Ocultar" : "Ver"} detalle del resultado ${index + 1}`);
    button.addEventListener("click", () => this.toggleDetail(row));
    return button;
  }

  private toggleDetail(row: LabelRead): void {
    if (!this.expanded.delete(row.id)) {
      this.expanded.add(row.id);
    }
    this.render();
  }

  private async remove(row: LabelRead): Promise<void> {
    const token = this.getAccessToken();
    if (!token || this.mutating) return;
    this.mutating = true;
    this.render();
    try {
      await readsApi.deleteRead(row.id, token);
      this.rows = this.rows.filter((item) => item.id !== row.id);
      this.expanded.delete(row.id);
      this.render();
      this.setStatus("Resultado borrado.", "neutral");
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "No se pudo borrar el resultado.", "error");
    } finally {
      this.mutating = false;
      this.render();
    }
  }

  private async clear(): Promise<void> {
    const token = this.getAccessToken();
    if (!token || this.mutating || this.rows.length === 0) return;
    const confirmed = window.confirm(`¿Borrar los ${this.rows.length} resultados guardados? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    this.onCleared?.();
    this.mutating = true;
    this.render();
    try {
      await readsApi.deleteAllReads(token);
      this.rows = [];
      this.expanded.clear();
      this.render();
      this.setStatus("Se borraron todos los resultados guardados.", "neutral");
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "No se pudieron borrar los resultados.", "error");
    } finally {
      this.mutating = false;
      this.render();
    }
  }

  private export(): void {
    if (this.rows.length === 0) {
      return;
    }

    try {
      const bytes = sheetBytes({
        name: "Etiquetas",
        columns: exportColumns(),
        rows: this.rows,
      });
      downloadWorkbook(`etiquetas-${localStamp()}.xlsx`, bytes);
      this.setStatus(`Archivo generado con ${this.rows.length} filas.`, "neutral");
    } catch {
      this.setStatus("No se pudo generar el archivo.", "error");
    }
  }

  private setStatus(message: string, tone: "neutral" | "error"): void {
    this.status.textContent = message;
    this.status.classList.toggle("is-error", tone === "error");
  }

  private require(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element;
  }
}

/** Mirrors the server's filters for a read that arrives by another road than the list. */
export function matchesFilter(read: LabelRead, filter: ReadFilter): boolean {
  if (filter.validation && read.validation_status !== filter.validation) return false;
  if (filter.review && (read.review_status ?? "pending") !== filter.review) return false;
  if (filter.query?.trim()) {
    const needle = filter.query.trim().toLowerCase();
    const haystack = [read.filename, read.destinatario, read.destino, read.tracking, read.direccion, read.codigo_postal]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function createReviewBadge(status: ReviewStatus | undefined): HTMLElement {
  const presentation = REVIEW_PRESENTATION[status ?? "pending"];
  const badge = document.createElement("span");
  badge.className = `review-badge is-${presentation.tone}`;
  badge.dataset.review = status ?? "pending";
  badge.textContent = presentation.label;
  badge.title = presentation.description;
  return badge;
}

function cell(className: string, text: string, title?: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  if (title) {
    td.title = title;
  }
  return td;
}

function safeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return dateFormatter.format(date);
}

function exportColumns(): SheetColumn<LabelRead>[] {
  return [
    { header: "Fecha", width: 18, value: (row) => new Date(row.created_at) },
    { header: "Estado", width: 12, value: (row) => (row.validation_status ? STATUS_PRESENTATION[row.validation_status].label : "") },
    { header: "Revisión", width: 14, value: (row) => REVIEW_PRESENTATION[row.review_status ?? "pending"].label },
    { header: "Motivos", width: 48, value: (row) => (row.issues ?? []).map(describeIssue).join(" · ") },
    { header: "Destino", width: 26, value: (row) => row.destino ?? "" },
    { header: "Código postal", width: 14, value: (row) => row.codigo_postal ?? "" },
    { header: "Destinatario", width: 28, value: (row) => row.destinatario ?? "" },
    { header: "Dirección", width: 34, value: (row) => row.direccion ?? "" },
    { header: "Tracking", width: 18, value: (row) => row.tracking ?? "" },
    { header: "QR", width: 26, value: (row) => row.qr_raw ?? "" },
    { header: "Contenido", width: 52, value: (row) => row.content },
    { header: "Origen", width: 14, value: (row) => (row.source === "image" ? "Imagen" : "Cámara") },
    { header: "Archivo", width: 30, value: (row) => row.filename ?? "" },
  ];
}

function localStamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
