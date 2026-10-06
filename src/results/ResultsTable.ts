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
  private readonly getAccessToken: () => string | null;
  private rows: LabelRead[] = [];
  private loading = false;

  constructor(options: { getAccessToken: () => string | null }) {
    this.getAccessToken = options.getAccessToken;
    this.body = this.require("resultsTableBody") as HTMLTableSectionElement;
    this.status = this.require("resultsTableStatus");
    this.count = this.require("resultsCount");
    this.exportButton = this.require("exportXlsxButton") as HTMLButtonElement;
    this.refreshButton = this.require("refreshResultsButton") as HTMLButtonElement;

    this.refreshButton.addEventListener("click", () => void this.refresh());
    this.exportButton.addEventListener("click", () => this.export());
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
      this.refreshButton.disabled = false;
    }
  }

  private render(): void {
    this.body.replaceChildren();
    this.count.textContent = `${this.rows.length} ${this.rows.length === 1 ? "etiqueta" : "etiquetas"}`;
    this.exportButton.disabled = this.rows.length === 0;

    if (this.rows.length === 0) {
      const empty = document.createElement("tr");
      empty.className = "table-empty";
      const cell = document.createElement("td");
      cell.colSpan = 5;
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
    tr.appendChild(cell("col-content", row.content));

    const sourceCell = document.createElement("td");
    sourceCell.className = "col-source";
    const badge = document.createElement("span");
    badge.className = `source-badge is-${row.source}`;
    badge.textContent = row.source === "image" ? "Imagen" : "Cámara";
    sourceCell.appendChild(badge);
    tr.appendChild(sourceCell);

    tr.appendChild(cell("col-file", row.filename ?? "—", row.filename));
    return tr;
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
