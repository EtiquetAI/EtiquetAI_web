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
  private readonly onUploaded?: (image: UploadedImage) => void;
  private busy = false;

  constructor(options: {
    getAccessToken: () => string | null;
    onUploaded?: (image: UploadedImage) => void;
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
      const file = this.input.files?.[0];
      if (file) {
        void this.handleFile(file);
      }
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
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        void this.handleFile(file);
      }
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

  private async handleFile(file: File): Promise<void> {
    if (this.busy) return;

    const validationError = imagesApi.validateImageFile(file);
    if (validationError) {
      this.showPreview(file);
      this.setStatus(validationError, "error");
      return;
    }

    const token = this.getAccessToken();
    if (!token) {
      this.setStatus("Tu sesión expiró. Volvé a iniciar sesión.", "error");
      return;
    }

    this.showPreview(file);
    this.busy = true;
    this.setStatus(`Subiendo ${file.name}…`, "neutral");

    try {
      const uploaded = await imagesApi.uploadImage(file, token);
      this.setStatus(
        uploaded.qr_content
          ? `Imagen guardada. QR leído: ${uploaded.qr_content}`
          : "Imagen guardada. No se encontró un código QR en la imagen.",
        "success"
      );
      this.onUploaded?.(uploaded);
      await this.refresh();
    } catch (error) {
      this.setStatus(describeError(error), "error");
    } finally {
      this.busy = false;
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
