import { isFilterActive, readsApi, type LabelRead, type ReadFilter, type ReviewStatus } from "../api/reads.js";
import type { ValidationStatus } from "../api/vision.js";
import { downloadBlob } from "../export/download.js";
import { downloadWorkbook, sheetBytes, type SheetColumn } from "../export/xlsx.js";
import { createResultDetail, hasDetail } from "./ResultDetail.js";
import { createStatusBadge } from "./StatusBadge.js";
import { REVIEW_PRESENTATION, STATUS_PRESENTATION, describeIssue } from "./status.js";

const QUERY_DEBOUNCE_MS = 300;
const DEFAULT_PAGE_SIZE = 20;
const REFRESH_DEBOUNCE_MS = 400;

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
  /** A redraw held back because the person was typing or in the middle of a click. */
  private renderDeferred = false;
  private pointerDown = false;
  private pendingCount = 0;
  private pendingNotice: HTMLElement | null = null;
  /** Bumped when the account changes, so an answer meant for the previous one is dropped. */
  private generation = 0;
  private page = 1;
  private pageSize = DEFAULT_PAGE_SIZE;
  /** How many reads match the filters in all, which is more than the page on screen. */
  private total = 0;
  private refreshQueued = false;
  private refreshTimer: number | undefined;
  private readonly pager: HTMLElement;
  private readonly pagerInfo: HTMLElement;
  private readonly pagerLabel: HTMLElement;
  private readonly pageSizeSelect: HTMLSelectElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;

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
    this.pendingNotice = document.getElementById("resultsPending");
    this.pager = this.require("resultsPager");
    this.pagerInfo = this.require("resultsPagerInfo");
    this.pagerLabel = this.require("resultsPageLabel");
    this.pageSizeSelect = this.require("resultsPageSize") as HTMLSelectElement;
    this.prevButton = this.require("resultsPrev") as HTMLButtonElement;
    this.nextButton = this.require("resultsNext") as HTMLButtonElement;
    this.pageSizeSelect.value = String(this.pageSize);
    this.prevButton.addEventListener("click", () => this.goToPage(this.page - 1));
    this.nextButton.addEventListener("click", () => this.goToPage(this.page + 1));
    this.pageSizeSelect.addEventListener("change", () => {
      this.pageSize = Number(this.pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
      this.page = 1;
      void this.refresh();
    });

    // Background updates must never rebuild the table under the person's hands: a click is a
    // press and a release on the same element, and a form is worthless if it is wiped while typed in.
    this.body.addEventListener("pointerdown", () => {
      this.pointerDown = true;
    });
    const release = (): void => {
      if (!this.pointerDown) return;
      this.pointerDown = false;
      window.setTimeout(() => this.flushDeferred(), 0);
    };
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", release);
    this.body.addEventListener("focusout", () => window.setTimeout(() => this.flushDeferred(), 0));

    this.refreshButton.addEventListener("click", () => void this.refresh());
    this.exportButton.addEventListener("click", () => void this.export());
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
    this.page = 1;
    void this.refresh();
  }

  private goToPage(page: number): void {
    const last = Math.max(1, Math.ceil(this.total / this.pageSize));
    const target = Math.min(Math.max(page, 1), last);
    if (target === this.page) return;
    this.page = target;
    void this.refresh();
  }

  private lastPage(): number {
    return Math.max(1, Math.ceil(this.total / this.pageSize));
  }

  /** First row number of the current page, so rows are numbered across pages and not from 1 on each. */
  private firstRowNumber(): number {
    return (this.page - 1) * this.pageSize + 1;
  }

  private updatePager(): void {
    this.pager.hidden = this.total === 0;
    if (this.total === 0) return;
    const from = this.firstRowNumber();
    const to = Math.min(from + this.rows.length - 1, this.total);
    this.pagerInfo.textContent = `Mostrando ${from}–${Math.max(to, from)} de ${this.total}`;
    this.pagerLabel.textContent = `Página ${this.page} de ${this.lastPage()}`;
    this.prevButton.disabled = this.page <= 1;
    this.nextButton.disabled = this.page >= this.lastPage();
  }

  /** Asks the server for the current page soon, folding several requests into one. */
  private refreshSoon(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      if (this.isBusyWithUser()) {
        this.refreshQueued = true;
        return;
      }
      void this.refresh({ quiet: true });
    }, REFRESH_DEBOUNCE_MS);
  }

  async refresh(options: { quiet?: boolean } = {}): Promise<void> {
    const token = this.getAccessToken();
    if (token === null) {
      return;
    }
    if (this.loading) {
      this.refreshQueued = true;
      return;
    }

    this.loading = true;
    if (!options.quiet) {
      this.refreshButton.disabled = true;
      this.setStatus("Consultando la base de datos…", "neutral");
    }
    const generation = this.generation;

    try {
      let result = await readsApi.listReadsPage(token, this.filter, { limit: this.pageSize, offset: (this.page - 1) * this.pageSize });
      if (generation !== this.generation) return; // the account changed while this was on its way
      if (result.reads.length === 0 && result.total > 0 && this.page > 1) {
        // The page the person was on no longer exists (rows were deleted): go to the last one.
        this.page = Math.max(1, Math.ceil(result.total / this.pageSize));
        result = await readsApi.listReadsPage(token, this.filter, { limit: this.pageSize, offset: (this.page - 1) * this.pageSize });
        if (generation !== this.generation) return;
      }
      this.rows = result.reads;
      this.total = result.total;
      this.render();
      if (this.rows.length === 0 && isFilterActive(this.filter)) {
        this.setStatus("Ninguna lectura coincide con los filtros.", "neutral");
      } else if (this.rows.length === 0) {
        this.setStatus("Todavía no hay etiquetas guardadas. Escaneá un código o subí una imagen.", "neutral");
      } else if (!options.quiet) {
        this.setStatus("", "neutral");
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "No se pudieron cargar los resultados.", "error");
    } finally {
      this.loading = false;
      this.refreshButton.disabled = this.mutating;
      if (this.refreshQueued && generation === this.generation) {
        this.refreshQueued = false;
        this.refreshSoon();
      }
    }
  }

  /** Folds reads that arrived while a batch moves through the OCR queue into the table. */
  mergeReads(updates: LabelRead[]): void {
    if (updates.length === 0) return;

    // A lot cannot be mirrored in the browser (a read does not carry its lot): ask the server instead.
    if (this.filter.batchId) {
      this.refreshSoon();
      return;
    }

    const known = new Set(this.rows.map((row) => row.id));
    const matching = updates.filter((update) => matchesFilter(update, this.filter));
    const arrivals = matching.filter((update) => !known.has(update.id));
    const departed = updates.filter((update) => !matchesFilter(update, this.filter) && known.has(update.id));

    const byID = new Map(this.rows.map((row) => [row.id, row]));
    for (const update of matching) if (known.has(update.id)) byID.set(update.id, update);
    for (const update of departed) byID.delete(update.id);

    let next = Array.from(byID.values());
    if (this.page === 1) {
      // The newest reads belong on the first page: they push the oldest one off it.
      for (const arrival of arrivals) byID.set(arrival.id, arrival);
      next = Array.from(byID.values()).sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)).slice(0, this.pageSize);
    }
    const added = arrivals.length;
    const totalChanged = added > 0 || departed.length > 0;
    if (totalChanged) this.total = Math.max(0, this.total + added - departed.length);

    // The watcher brings the same reads again on every poll. Nothing to draw means nothing to disturb.
    if (sameRows(this.rows, next)) {
      if (totalChanged) this.updatePager();
      return;
    }
    this.rows = next;
    if (this.isBusyWithUser()) {
      this.renderDeferred = true;
      return;
    }
    this.render();
  }

  /** True while redrawing would cost the person something: a pending click, a dirty form, a focused field. */
  private isBusyWithUser(): boolean {
    if (this.pointerDown || this.body.querySelector(".review-form.is-dirty") !== null) return true;
    const active = document.activeElement;
    return (
      active !== null &&
      this.body.contains(active) &&
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)
    );
  }

  private flushDeferred(): void {
    if (this.isBusyWithUser()) return;
    if (this.renderDeferred) this.render();
    if (this.refreshQueued && !this.loading) {
      this.refreshQueued = false;
      void this.refresh({ quiet: true });
    }
  }

  /** How many uploaded images the OCR has not finished yet, so the table can say why rows are still missing. */
  setPendingCount(count: number): void {
    this.pendingCount = count;
    if (this.pendingNotice === null) return;
    this.pendingNotice.hidden = count === 0;
    this.pendingNotice.textContent =
      count === 0
        ? ""
        : `${count} ${count === 1 ? "imagen todavía se está procesando" : "imágenes todavía se están procesando"}: sus resultados aparecen acá a medida que se leen.`;
  }

  /** Forgets everything that belongs to the previous account. */
  reset(): void {
    this.generation++;
    this.rows = [];
    this.total = 0;
    this.page = 1;
    this.pageSize = DEFAULT_PAGE_SIZE;
    this.pageSizeSelect.value = String(DEFAULT_PAGE_SIZE);
    this.refreshQueued = false;
    window.clearTimeout(this.refreshTimer);
    this.expanded.clear();
    this.filter = {};
    this.validationFilter.value = "";
    this.reviewFilter.value = "";
    this.queryFilter.value = "";
    this.setBatches([]);
    this.clearFilters.hidden = true;
    this.loading = false;
    this.mutating = false;
    this.exporting = false;
    this.pointerDown = false;
    this.setStatus("", "neutral");
    this.setPendingCount(0);
    this.render();
  }

  notify(message: string, tone: "neutral" | "error"): void {
    this.setStatus(message, tone);
  }

  private render(): void {
    this.updatePager();
    this.renderDeferred = false;
    this.body.replaceChildren();
    this.count.textContent = `${this.rows.length} ${this.rows.length === 1 ? "etiqueta" : "etiquetas"}`;
    this.refreshButton.disabled = this.loading || this.mutating;
    this.exportButton.disabled = this.rows.length === 0 || this.mutating || this.exporting;
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

    tr.appendChild(cell("col-index", String(this.firstRowNumber() + index)));
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
    removeButton.setAttribute("aria-label", `Borrar resultado ${this.firstRowNumber() + index}`);
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
    button.setAttribute("aria-label", `${isOpen ? "Ocultar" : "Ver"} detalle del resultado ${this.firstRowNumber() + index}`);
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
      this.total = Math.max(0, this.total - 1);
      this.expanded.delete(row.id);
      this.render();
      this.setStatus("Resultado borrado.", "neutral");
      this.refreshSoon(); // refill the page and correct the total
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
    const confirmed = window.confirm(`¿Borrar los ${this.total} resultados guardados? Esta acción no se puede deshacer.`);
    if (!confirmed) return;

    this.onCleared?.();
    this.mutating = true;
    this.render();
    try {
      await readsApi.deleteAllReads(token);
      this.rows = [];
      this.total = 0;
      this.page = 1;
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

  /** Excel holds every read that matches the filters, not only the page on screen. */
  private async export(): Promise<void> {
    const token = this.getAccessToken();
    if (this.rows.length === 0 || token === null || this.exporting) {
      return;
    }

    this.exporting = true;
    this.render();
    this.setStatus("Preparando el archivo…", "neutral");
    try {
      const all = expandLabels(await readsApi.listAllReads(token, this.filter));
      const bytes = sheetBytes({ name: "Etiquetas", columns: exportColumns(), rows: all });
      downloadWorkbook(`etiquetas-${localStamp()}.xlsx`, bytes);
      this.setStatus(`Archivo generado con ${all.length} filas.`, "neutral");
    } catch {
      this.setStatus("No se pudo generar el archivo.", "error");
    } finally {
      this.exporting = false;
      this.render();
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

/** Whether two lists hold exactly the same reads in the same order. */
export function sameRows(left: LabelRead[], right: LabelRead[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => row === right[index] || JSON.stringify(row) === JSON.stringify(right[index]));
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

/**
 * One row per label: a sheet of six labels is one read in the table but six lines in a file,
 * otherwise an export would silently drop five of them. Extra rows are told apart by an id
 * ending in `#<position>`.
 */
export function expandLabels(rows: LabelRead[]): LabelRead[] {
  return rows.flatMap((row) => [
    row,
    ...(row.extra_labels ?? []).map(
      (extra, index): LabelRead => ({
        ...row,
        id: `${row.id}#${index + 2}`,
        destinatario: extra.destinatario,
        direccion: extra.direccion,
        codigo_postal: extra.codigo_postal,
        destino: extra.destino,
        tracking: extra.tracking,
        validation_status: extra.validation_status,
        issues: extra.issues,
        review_status: "pending",
        corrections: {},
        extra_labels: [],
      }),
    ),
  ]);
}

function labelPosition(row: LabelRead): string {
  const total = row.label_count ?? 1;
  if (total <= 1) return "";
  const position = /#(\d+)$/.exec(row.id)?.[1] ?? "1";
  return `${position} de ${total}`;
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
    { header: "Etiqueta", width: 12, value: labelPosition },
  ];
}

function localStamp(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
