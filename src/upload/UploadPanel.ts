import { imagesApi, type UploadedImage } from "../api/images.js";
import { ApiHttpError } from "../api/auth.js";

export class UploadPanel {
  private readonly dropzone: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly preview: HTMLElement;
  private readonly previewImage: HTMLImageElement;
  private readonly previewCaption: HTMLElement;
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly getAccessToken: () => string | null;
  private readonly onUploaded?: (images: UploadedImage[]) => void;
  private readonly uploadQueue: File[] = [];
  private processing = false;
  private rejectedCount = 0;

  constructor(options: {
    getAccessToken: () => string | null;
    onUploaded?: (images: UploadedImage[]) => void;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.onUploaded = options.onUploaded;

    this.dropzone = this.require("uploadDropzone");
    this.input = this.require("imageInput") as HTMLInputElement;
    this.preview = this.require("uploadPreview");
    this.previewImage = this.require("uploadPreviewImage") as HTMLImageElement;
    this.previewCaption = this.require("uploadPreviewCaption");
    this.status = this.require("uploadStatus");
    this.list = this.require("uploadedList");

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

  async refresh(): Promise<void> {
    const token = this.getAccessToken();
    if (!token) return;

    try {
      this.render(await imagesApi.listImages(token));
    } catch {
      this.setStatus("No se pudo consultar las imágenes guardadas.", "error");
    }
  }

  private async enqueueFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const validationError = imagesApi.validateImageFile(file);
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
    let uploadedCount = 0;
    let failedCount = 0;
    const uploadedImages: UploadedImage[] = [];
    try {
      while (this.uploadQueue.length > 0) {
        const file = this.uploadQueue.shift();
        if (!file) continue;
        this.showPreview(file);
        this.setStatus(`Subiendo ${file.name}… (${this.uploadQueue.length} en espera)`, "neutral");

        const token = this.getAccessToken();
        if (!token) {
          failedCount += 1 + this.uploadQueue.length;
          this.uploadQueue.length = 0;
          this.setStatus("Tu sesión expiró. Volvé a iniciar sesión.", "error");
          break;
        }

        try {
          uploadedImages.push(await imagesApi.uploadImage(file, token));
          uploadedCount++;
        } catch (error) {
          failedCount++;
          this.setStatus(`${file.name}: ${describeError(error)}`, "error");
        }
      }
    } finally {
      this.processing = false;
    }

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

  private render(images: UploadedImage[]): void {
    this.list.replaceChildren();

    for (const image of images) {
      this.list.appendChild(this.renderItem(image));
    }

    if (images.length === 0) {
      this.setStatus("Todavía no cargaste imágenes. Empezá por una foto de etiqueta.", "neutral");
    }
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
