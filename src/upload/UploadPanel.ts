import { imagesApi, type BatchUploadResult, type UploadedImage } from "../api/images.js";
import { ApiHttpError } from "../api/auth.js";
import { describeRejection } from "../results/status.js";
import { describeOcrState, isWaitingForOcr, mergeImage } from "./ocrState.js";

export interface UploadBatchOption {
  id: string;
  label: string;
}

const batchDate = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function newBatchId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "";
}

/** Counts of what the OCR is doing with the images on screen. */
export function ocrProgress(images: UploadedImage[]): { waiting: number; failed: number; done: number } {
  let waiting = 0;
  let failed = 0;
  let done = 0;
  for (const image of images) {
    if (image.ocr_status === "queued") waiting++;
    else if (image.ocr_status === "failed" || image.ocr_status === "not_queued") failed++;
    else if (image.ocr_status === "done") done++;
  }
  return { waiting, failed, done };
}

/** One entry per upload that carried a batch id, newest first, for the results filter. */
export function batchOptions(images: UploadedImage[]): UploadBatchOption[] {
  const groups = new Map<string, { count: number; first: number }>();
  for (const image of images) {
    if (!image.batch_id) continue;
    const created = Date.parse(image.created_at);
    const group = groups.get(image.batch_id) ?? { count: 0, first: Number.POSITIVE_INFINITY };
    group.count++;
    if (!Number.isNaN(created)) group.first = Math.min(group.first, created);
    groups.set(image.batch_id, group);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[1].first - a[1].first)
    .map(([id, group]) => ({
      id,
      label: `Lote del ${Number.isFinite(group.first) ? batchDate.format(new Date(group.first)) : "—"} · ${group.count} ${group.count === 1 ? "imagen" : "imágenes"}`,
    }));
}

export class UploadPanel {
  private readonly dropzone: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly preview: HTMLElement;
  private readonly previewImage: HTMLImageElement;
  private readonly previewCaption: HTMLElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly report: HTMLElement;
  private readonly retryAllButton: HTMLButtonElement;
  private readonly onBatches?: (batches: UploadBatchOption[]) => void;
  private retrying = false;
  /** Bumped when the account changes, so work started for the previous one is dropped. */
  private generation = 0;
  private readonly onPendingCount?: (count: number) => void;
  private readonly refreshButton: HTMLElement | null;
  private readonly getAccessToken: () => string | null;
  private readonly onUploaded?: (images: UploadedImage[]) => void;
  private readonly onPendingImages?: (imageIDs: string[]) => void;
  private readonly uploadQueue: File[] = [];
  private images: UploadedImage[] = [];
  private processing = false;
  private rejectedCount = 0;

  constructor(options: {
    getAccessToken: () => string | null;
    onUploaded?: (images: UploadedImage[]) => void;
    onPendingImages?: (imageIDs: string[]) => void;
    onBatches?: (batches: UploadBatchOption[]) => void;
    /** Told how many images are still waiting for the OCR whenever that changes. */
    onPendingCount?: (count: number) => void;
  }) {
    this.onBatches = options.onBatches;
    this.onPendingCount = options.onPendingCount;
    this.getAccessToken = options.getAccessToken;
    this.onUploaded = options.onUploaded;
    this.onPendingImages = options.onPendingImages;

    this.dropzone = this.require("uploadDropzone");
    this.input = this.require("imageInput") as HTMLInputElement;
    this.preview = this.require("uploadPreview");
    this.previewImage = this.require("uploadPreviewImage") as HTMLImageElement;
    this.previewCaption = this.require("uploadPreviewCaption");
    this.status = this.require("uploadStatus");
    this.list = this.require("uploadedList");
    this.progress = this.require("uploadProgress");
    this.report = this.require("uploadBatchReport");
    this.retryAllButton = this.require("retryFailedButton") as HTMLButtonElement;
    this.retryAllButton.addEventListener("click", () => void this.retryAll());
    this.refreshButton = document.getElementById("refreshUploadsButton");
    this.refreshButton?.addEventListener("click", () => void this.refresh({ followPending: true }));

    this.input.addEventListener("change", () => {
      const files = Array.from(this.input.files ?? []);
      if (files.length > 0) void this.enqueueFiles(files);
      this.input.value = "";
    });

    this.dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.dropzone.classList.add("is-dragging");
    });

    this.dropzone.addEventListener("dragleave", () => {
      this.dropzone.classList.remove("is-dragging");
    });

    this.dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      this.dropzone.classList.remove("is-dragging");
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) void this.enqueueFiles(files);
    });
  }

  /**
   * Reloads the saved images. With `followPending`, images still waiting for the
   * OCR (for example from an earlier session) are handed to `onPendingImages`.
   */
  async refresh(options: { followPending?: boolean } = {}): Promise<void> {
    const token = this.getAccessToken();
    if (!token) return;
    const generation = this.generation;

    try {
      const images = await imagesApi.listImages(token);
      if (generation !== this.generation) return; // the account changed while this was on its way
      this.setImages(images);
    } catch {
      this.setStatus("No se pudo consultar las imágenes guardadas.", "error");
      return;
    }

    if (options.followPending) {
      const waiting = this.images.filter(isWaitingForOcr).map((image) => image.id);
      if (waiting.length > 0) this.onPendingImages?.(waiting);
    }
  }

  /** Applies fresh OCR state to the images already listed, without clearing the status message. */
  updateImages(updates: UploadedImage[]): void {
    if (updates.length === 0) return;

    const known = new Map(this.images.map((image) => [image.id, image]));
    const merged = this.images.map((image) => mergeImage(image, updates.find((update) => update.id === image.id) ?? image));
    const added = updates.filter((update) => !known.has(update.id));
    const next = [...added, ...merged];
    // Every poll brings the same state again; redrawing it would also swallow a click on Reintentar.
    if (JSON.stringify(next) === JSON.stringify(this.images)) return;
    this.images = next;
    this.renderList();
  }

  /** Forgets everything that belongs to the previous account. */
  reset(): void {
    this.generation++;
    this.images = [];
    this.uploadQueue.length = 0;
    this.processing = false;
    this.retrying = false;
    this.rejectedCount = 0;
    this.report.replaceChildren();
    this.preview.hidden = true;
    if (this.previewImage.dataset.objectUrl) {
      URL.revokeObjectURL(this.previewImage.dataset.objectUrl);
      delete this.previewImage.dataset.objectUrl;
    }
    this.previewImage.removeAttribute("src");
    this.setStatus("", "neutral");
    this.renderList();
  }

  /**
   * Replaces images with the state the server just reported. Unlike
   * `updateImages`, a waiting state may follow a finished one: a retry is
   * exactly the case where a failed image goes back to waiting.
   */
  private replaceImages(updates: UploadedImage[]): void {
    const byID = new Map(updates.map((image) => [image.id, image]));
    this.images = this.images.map((image) => byID.get(image.id) ?? image);
    this.renderList();
  }

  private setImages(incoming: UploadedImage[]): void {
    const previous = new Map(this.images.map((image) => [image.id, image]));
    const next = incoming.map((image) => mergeImage(previous.get(image.id), image));
    // Asking again for the same state must not redraw (and swallow a click on Reintentar).
    if (this.images.length > 0 && JSON.stringify(next) === JSON.stringify(this.images)) return;
    this.images = next;
    this.render();
  }

  private async enqueueFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const validationError = imagesApi.isZipFile(file) ? imagesApi.validateZipFile(file) : imagesApi.validateImageFile(file);
      if (validationError) {
        this.rejectedCount++;
        this.setStatus(`${file.name}: ${validationError}`, "error");
        continue;
      }
      this.uploadQueue.push(file);
    }

    if (this.uploadQueue.length === 0) {
      if (!this.processing) this.rejectedCount = 0;
      return;
    }
    if (this.processing) {
      this.setStatus(`${this.uploadQueue.length} imagen(es) en espera.`, "neutral");
      return;
    }

    this.processing = true;
    const generation = this.generation;
    let uploadedCount = 0;
    let failedCount = 0;
    const uploadedImages: UploadedImage[] = [];
    // Several loose images selected together form one batch, like a zip does.
    const looseCount = this.uploadQueue.filter((queued) => !imagesApi.isZipFile(queued)).length;
    const selectionBatch = looseCount > 1 ? newBatchId() : "";
    this.report.replaceChildren();
    try {
      while (this.uploadQueue.length > 0 && generation === this.generation) {
        const file = this.uploadQueue.shift();
        if (!file) continue;
        const isZip = imagesApi.isZipFile(file);
        if (!isZip) this.showPreview(file);
        this.setStatus(`${isZip ? "Descomprimiendo" : "Subiendo"} ${file.name}… (${this.uploadQueue.length} en espera)`, "neutral");

        const token = this.getAccessToken();
        if (!token) {
          failedCount += 1 + this.uploadQueue.length;
          this.uploadQueue.length = 0;
          this.setStatus("Tu sesión expiró. Volvé a iniciar sesión.", "error");
          break;
        }

        try {
          if (isZip) {
            const result = await imagesApi.uploadBatchZip(file, token);
            uploadedImages.push(...result.accepted);
            uploadedCount += result.accepted.length;
            failedCount += result.rejected.length;
            this.showBatchReport(file.name, result);
          } else {
            uploadedImages.push(await imagesApi.uploadImage(file, token, selectionBatch || undefined));
            uploadedCount++;
          }
        } catch (error) {
          failedCount++;
          this.setStatus(`${file.name}: ${describeError(error)}`, "error");
        }
      }
    } finally {
      this.processing = false;
    }

    if (generation !== this.generation) return; // signed out (or switched account) mid-upload
    failedCount += this.rejectedCount;
    this.rejectedCount = 0;

    if (uploadedCount > 0) {
      this.onUploaded?.(uploadedImages);
      await this.refresh();
    }
    if (uploadedCount > 0 && failedCount === 0) {
      this.setStatus(`Se cargaron ${uploadedCount} imagen(es). El OCR está procesando las etiquetas.`, "success");
    } else if (uploadedCount > 0) {
      this.setStatus(`Se cargaron ${uploadedCount}; ${failedCount} no se pudieron cargar.`, "error");
    } else if (failedCount > 0) {
      this.setStatus(`${failedCount} imagen(es) no se pudieron cargar.`, "error");
    }
  }

  private showBatchReport(name: string, result: BatchUploadResult): void {
    const summary = document.createElement("p");
    summary.className = "upload-report-summary";
    summary.textContent = `${name}: ${result.accepted.length} de ${result.total} ${result.total === 1 ? "imagen aceptada" : "imágenes aceptadas"}.`;
    this.report.appendChild(summary);

    if (result.rejected.length > 0) {
      const list = document.createElement("ul");
      list.className = "upload-report-list";
      for (const rejection of result.rejected) {
        const item = document.createElement("li");
        item.textContent = `${rejection.filename}: ${describeRejection(rejection.reason)}`;
        list.appendChild(item);
      }
      this.report.appendChild(list);
    }
  }

  private async retry(image: UploadedImage): Promise<void> {
    const token = this.getAccessToken();
    if (!token || this.retrying) return;
    this.retrying = true;
    try {
      const updated = await imagesApi.retryImage(image.id, token);
      this.replaceImages([updated]);
      this.onPendingImages?.([updated.id]);
      this.setStatus(`${image.filename}: se volvió a enviar al OCR.`, "success");
    } catch (error) {
      this.setStatus(`${image.filename}: ${describeError(error)}`, "error");
    } finally {
      this.retrying = false;
      this.renderList();
    }
  }

  private async retryAll(): Promise<void> {
    const token = this.getAccessToken();
    if (!token || this.retrying) return;
    this.retrying = true;
    this.renderList();
    try {
      const report = await imagesApi.retryFailedImages(token);
      this.replaceImages(report.images);
      if (report.images.length > 0) this.onPendingImages?.(report.images.map((image) => image.id));
      this.setStatus(
        report.failed > 0
          ? `Se reenviaron ${report.retried}; ${report.failed} siguen sin poder enviarse.`
          : `Se reenviaron ${report.retried} imagen(es) al OCR.`,
        report.failed > 0 ? "error" : "success",
      );
    } catch (error) {
      this.setStatus(describeError(error), "error");
    } finally {
      this.retrying = false;
      this.renderList();
    }
  }

  private renderProgress(): void {
    const { waiting, failed } = ocrProgress(this.images);
    const parts: string[] = [];
    if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? "imagen esperando" : "imágenes esperando"} OCR`);
    if (failed > 0) parts.push(`${failed} con error`);
    this.progress.textContent = parts.join(" · ");
    this.progress.hidden = parts.length === 0;
    this.retryAllButton.hidden = failed === 0;
    this.retryAllButton.disabled = this.retrying;
    if (this.refreshButton) this.refreshButton.hidden = waiting === 0 && failed === 0;
    this.onPendingCount?.(waiting);
  }

  private showPreview(file: File): void {
    if (this.previewImage.dataset.objectUrl) {
      URL.revokeObjectURL(this.previewImage.dataset.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    this.previewImage.dataset.objectUrl = objectUrl;
    this.previewImage.src = objectUrl;
    this.previewCaption.textContent = `${file.name} · ${formatBytes(file.size)}`;
    this.preview.hidden = false;
  }

  private render(): void {
    this.renderList();

    if (this.images.length === 0) {
      this.setStatus("Todavía no cargaste imágenes. Empezá por una foto de etiqueta.", "neutral");
    }
  }

  private renderList(): void {
    this.list.replaceChildren(...this.images.map((image) => this.renderItem(image)));
    this.renderProgress();
    this.onBatches?.(batchOptions(this.images));
  }

  private renderItem(image: UploadedImage): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "uploaded-item";

    const name = document.createElement("span");
    name.className = "uploaded-item-name";
    name.textContent = image.filename;
    name.title = image.filename;

    const meta = document.createElement("span");
    meta.className = "uploaded-item-meta";
    meta.textContent = `${formatBytes(image.size_bytes)} · ${image.mime_type}`;

    const status = document.createElement("span");
    status.className = `uploaded-item-status is-${image.status}`;
    status.textContent = image.status;

    item.append(name, status, meta);

    const ocr = describeOcrState(image);
    if (ocr) {
      const badge = document.createElement("span");
      badge.className = `uploaded-item-ocr is-${ocr.tone}`;
      badge.dataset.ocrStatus = image.ocr_status;
      badge.textContent = ocr.label;
      if (ocr.detail) badge.title = ocr.detail;
      item.appendChild(badge);
    }

    if (image.ocr_status === "failed" || image.ocr_status === "not_queued") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "text-button uploaded-item-retry";
      retry.textContent = "Reintentar";
      retry.setAttribute("aria-label", `Reintentar ${image.filename}`);
      retry.disabled = this.retrying;
      retry.addEventListener("click", () => void this.retry(image));
      item.appendChild(retry);
    }

    if (image.qr_content) {
      const content = document.createElement("span");
      content.className = "uploaded-item-qr";
      content.textContent = image.qr_content;
      content.title = image.qr_content;
      item.appendChild(content);
    }

    if (image.error_message) {
      const error = document.createElement("span");
      error.className = "uploaded-item-error";
      error.textContent = image.error_message;
      item.appendChild(error);
    }

    return item;
  }

  private setStatus(message: string, tone: "neutral" | "success" | "error"): void {
    this.status.textContent = message;
    this.status.classList.toggle("is-error", tone === "error");
    this.status.classList.toggle("is-success", tone === "success");
  }

  private require(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ApiHttpError) {
    switch (error.code) {
      case "file_too_large":
        return "La imagen supera el límite permitido.";
      case "invalid_request":
        return "El archivo no es una imagen válida.";
      case "invalid_archive":
        return "El archivo no es un zip válido.";
      case "empty_archive":
        return "El zip no contiene archivos.";
      case "too_many_files":
        return "El zip tiene más imágenes que el máximo permitido.";
      case "not_retryable":
        return "Esa imagen ya fue leída o se está leyendo.";
      case "queue_disabled":
        return "El OCR está desactivado en este servidor.";
      case "queue_unavailable":
        return "El servicio de OCR no está disponible. Probá de nuevo en unos minutos.";
      case "unauthorized":
        return "Tu sesión expiró. Volvé a iniciar sesión.";
      default:
        return `La API rechazó la carga (HTTP ${error.status}).`;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "No se pudo subir la imagen.";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
