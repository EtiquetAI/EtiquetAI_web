import { readsApi, type LabelRead } from "../api/reads.js";
import { downloadWorkbook, sheetBytes, type SheetColumn } from "../export/xlsx.js";

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
  private readonly getAccessToken: () => string | null;
  private rows: LabelRead[] = [];
  private loading = false;
  private mutating = false;
  private watchGeneration = 0;

  constructor(options: { getAccessToken: () => string | null }) {
    this.getAccessToken = options.getAccessToken;
    this.body = this.require("resultsTableBody") as HTMLTableSectionElement;
    this.status = this.require("resultsTableStatus");
    this.count = this.require("resultsCount");
    this.exportButton = this.require("exportXlsxButton") as HTMLButtonElement;
    this.refreshButton = this.require("refreshResultsButton") as HTMLButtonElement;
    this.clearButton = this.require("clearResultsButton") as HTMLButtonElement;

    this.refreshButton.addEventListener("click", () => void this.refresh());
    this.exportButton.addEventListener("click", () => this.export());
    this.clearButton.addEventListener("click", () => void this.clear());
    this.render();
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
      this.rows = await readsApi.listReads(token);
      this.render();
      if (this.rows.length === 0) {
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

  /** Keep the results view current while a batch is moving through the OCR queue. */
  async watchImageResults(imageIDs: string[]): Promise<void> {
    const expected = new Set(imageIDs);
    if (expected.size === 0) return;

    const generation = ++this.watchGeneration;
    const deadline = Date.now() + Math.min(Math.max(15000, expected.size * 4000), 120000);
    while (Date.now() < deadline && generation === this.watchGeneration) {
      for (const row of this.rows) {
        if (row.image_id && expected.has(row.image_id) && hasLabelFields(row)) {
          expected.delete(row.image_id);
        }
      }
      if (expected.size === 0) return;

      const token = this.getAccessToken();
      if (!token) return;
      const remaining = Array.from(expected);
      for (let start = 0; start < remaining.length; start += 100) {
        const batch = remaining.slice(start, start + 100);
        try {
          const updates = await readsApi.listReadsForImages(batch, token);
          const byID = new Map(this.rows.map((row) => [row.id, row]));
          for (const update of updates) byID.set(update.id, update);
          this.rows = Array.from(byID.values()).sort(
            (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
          );
          this.render();
          for (const update of updates) {
            if (update.image_id && hasLabelFields(update)) expected.delete(update.image_id);
          }
        } catch (error) {
          this.setStatus(error instanceof Error ? error.message : "No se pudo actualizar el lote OCR.", "error");
        }
        if (generation !== this.watchGeneration) return;
      }
      if (expected.size === 0) return;

      await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
    }

    if (generation !== this.watchGeneration) return;

    this.setStatus(
      `${expected.size} imagen(es) todavía no tienen datos OCR disponibles. Podés actualizar la tabla más tarde.`,
      "neutral",
    );
  }

  private render(): void {
    this.body.replaceChildren();
    this.count.textContent = `${this.rows.length} ${this.rows.length === 1 ? "etiqueta" : "etiquetas"}`;
    this.refreshButton.disabled = this.loading || this.mutating;
    this.exportButton.disabled = this.rows.length === 0 || this.mutating;
    this.clearButton.disabled = this.rows.length === 0 || this.mutating;

    if (this.rows.length === 0) {
      const empty = document.createElement("tr");
      empty.className = "table-empty";
      const cell = document.createElement("td");
      cell.colSpan = Number(this.body.closest("table")?.querySelectorAll("thead th").length ?? 5);
      cell.textContent = "La tabla está vacía.";
      empty.appendChild(cell);
      this.body.appendChild(empty);
      return;
    }

    this.rows.forEach((row, index) => {
      this.body.appendChild(this.renderRow(row, index));
    });
  }

  private renderRow(row: LabelRead, index: number): HTMLTableRowElement {
    const tr = document.createElement("tr");

    tr.appendChild(cell("col-index", String(index + 1)));
    tr.appendChild(cell("col-date", safeDate(row.created_at)));
    tr.appendChild(cell("col-destino", row.destino ?? "—"));
    tr.appendChild(cell("col-cp", row.codigo_postal ?? "—"));
    tr.appendChild(cell("col-destinatario", row.destinatario ?? "—"));
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

  private async remove(row: LabelRead): Promise<void> {
    const token = this.getAccessToken();
    if (!token || this.mutating) return;
    this.mutating = true;
    this.render();
    try {
      await readsApi.deleteRead(row.id, token);
      this.rows = this.rows.filter((item) => item.id !== row.id);
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

    this.watchGeneration++;
    this.mutating = true;
    this.render();
    try {
      await readsApi.deleteAllReads(token);
      this.rows = [];
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

function cell(className: string, text: string, title?: string): HTMLTableCellElement {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  if (title) {
    td.title = title;
  }
  return td;
}

function hasLabelFields(row: LabelRead): boolean {
  return Boolean(row.destino || row.codigo_postal || row.destinatario || row.tracking);
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
    { header: "Destino", width: 26, value: (row) => row.destino ?? "" },
    { header: "Código postal", width: 14, value: (row) => row.codigo_postal ?? "" },
    { header: "Destinatario", width: 28, value: (row) => row.destinatario ?? "" },
    { header: "Tracking", width: 18, value: (row) => row.tracking ?? "" },
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
