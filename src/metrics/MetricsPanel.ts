import { metricsApi, type MetricsSummary } from "../api/metrics.js";
import { fieldLabel } from "../results/status.js";

const OCR_STATUS_LABELS: Record<string, string> = {
  done: "Leídas",
  queued: "Esperando OCR",
  failed: "El OCR falló",
  not_queued: "No se pudieron encolar",
  disabled: "OCR desactivado",
  unknown: "Sin información",
};
const VALIDATION_LABELS: Record<string, string> = { OK: "Correctas", REVIEW: "Para revisar", REJECTED: "Rechazadas", none: "Sin veredicto" };
const REVIEW_LABELS: Record<string, string> = { pending: "Sin revisar", confirmed: "Confirmadas", corrected: "Corregidas" };

const percent = new Intl.NumberFormat("es-AR", { style: "percent", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

export function formatRate(value: number | null): string {
  return value === null ? "—" : percent.format(value);
}

export function formatSeconds(value: number | null): string {
  if (value === null) return "—";
  return value >= 60 ? `${decimal.format(value / 60)} min` : `${decimal.format(value)} s`;
}

export function formatPerMinute(value: number | null): string {
  return value === null ? "—" : `${decimal.format(value)} / min`;
}

/** The ISO date a "last N days" period starts on, or undefined for the whole history. */
export function sinceFor(days: string, now: Date = new Date()): string | undefined {
  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return new Date(now.getTime() - count * 24 * 60 * 60 * 1000).toISOString();
}

export class MetricsPanel {
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly period: HTMLSelectElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly getAccessToken: () => string | null;
  private loading = false;

  constructor(options: { getAccessToken: () => string | null }) {
    this.getAccessToken = options.getAccessToken;
    this.body = this.require("metricsBody");
    this.status = this.require("metricsStatus");
    this.period = this.require("metricsPeriod") as HTMLSelectElement;
    this.refreshButton = this.require("refreshMetricsButton") as HTMLButtonElement;
    this.refreshButton.addEventListener("click", () => void this.refresh());
    this.period.addEventListener("change", () => void this.refresh());
  }

  /** Forgets the figures of the previous account. */
  reset(): void {
    this.body.replaceChildren();
    this.setStatus("", false);
    this.period.value = "";
    this.loading = false;
    this.refreshButton.disabled = false;
  }

  async refresh(): Promise<void> {
    const token = this.getAccessToken();
    if (token === null || this.loading) return;
    this.loading = true;
    this.refreshButton.disabled = true;
    this.setStatus("Calculando métricas…", false);
    try {
      this.render(await metricsApi.getMetricsSummary(token, sinceFor(this.period.value)));
      this.setStatus("", false);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : "No se pudieron cargar las métricas.", true);
    } finally {
      this.loading = false;
      this.refreshButton.disabled = false;
    }
  }

  private render(summary: MetricsSummary): void {
    const cards = document.createElement("div");
    cards.className = "metric-cards";
    cards.append(
      card("Imágenes procesadas", String(summary.timing.processed), `de ${summary.images.total} cargadas`, "processed"),
      card("Tiempo medio por imagen", formatSeconds(summary.timing.avgSeconds), "desde la carga hasta el resultado", "avg-time"),
      card("Velocidad", formatPerMinute(summary.timing.imagesPerMinute), "imágenes procesadas por minuto", "throughput"),
      card(
        "Requirieron corrección",
        formatRate(summary.reads.correctionRate),
        summary.reads.reviewed === 0 ? "todavía no se revisó ninguna lectura" : `${summary.reads.corrected} de ${summary.reads.reviewed} lecturas revisadas`,
        "correction-rate",
      ),
      card("Enviadas a revisión por el OCR", formatRate(summary.reads.needsAttentionRate), `de ${summary.reads.total} lecturas`, "needs-attention"),
    );

    const groups = document.createElement("div");
    groups.className = "metric-groups";
    groups.append(
      distribution("Estado del OCR", summary.images.byOcrStatus, OCR_STATUS_LABELS, "ocr-status"),
      distribution("Veredicto de la lectura", summary.reads.byValidation, VALIDATION_LABELS, "validation"),
      distribution("Revisión humana", summary.reads.byReview, REVIEW_LABELS, "review"),
      distribution("Correcciones por campo", summary.reads.correctedByField, Object.fromEntries(Object.keys(summary.reads.correctedByField).map((f) => [f, fieldLabel(f)])), "by-field"),
    );
    this.body.replaceChildren(cards, groups);
  }

  private setStatus(message: string, isError: boolean): void {
    this.status.textContent = message;
    this.status.classList.toggle("is-error", isError);
  }

  private require(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element #${id}`);
    return element;
  }
}

function card(title: string, value: string, hint: string, key: string): HTMLElement {
  const element = document.createElement("article");
  element.className = "metric-card";
  element.dataset.metric = key;
  const heading = document.createElement("h3");
  heading.textContent = title;
  const figure = document.createElement("p");
  figure.className = "metric-value";
  figure.textContent = value;
  const note = document.createElement("p");
  note.className = "metric-hint";
  note.textContent = hint;
  element.append(heading, figure, note);
  return element;
}

function distribution(title: string, counts: Record<string, number>, labels: Record<string, string>, key: string): HTMLElement {
  const section = document.createElement("section");
  section.className = "metric-group";
  section.dataset.group = key;
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.appendChild(heading);

  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "metric-hint";
    empty.textContent = "Sin datos todavía.";
    section.appendChild(empty);
    return section;
  }

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const list = document.createElement("ul");
  list.className = "metric-bars";
  for (const [name, count] of entries.sort((a, b) => b[1] - a[1])) {
    const item = document.createElement("li");
    item.dataset.key = name;
    const label = document.createElement("span");
    label.textContent = labels[name] ?? name;
    const bar = document.createElement("span");
    bar.className = "metric-bar";
    const fill = document.createElement("span");
    fill.className = "metric-bar-fill";
    fill.style.width = `${Math.max(2, Math.round((count / total) * 100))}%`;
    bar.appendChild(fill);
    const value = document.createElement("span");
    value.className = "metric-count";
    value.textContent = String(count);
    item.append(label, bar, value);
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}
