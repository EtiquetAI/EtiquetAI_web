import { imagesApi, type UploadedImage } from "../api/images.js";
import { readsApi, type LabelRead } from "../api/reads.js";
import { isOcrSettled } from "../api/vision.js";

const POLL_INTERVAL_MS = 2500;
const MIN_WAIT_MS = 15000;
const MAX_WAIT_MS = 120000;
const PER_IMAGE_WAIT_MS = 4000;
const BATCH_SIZE = 100;

export interface OcrWatcherHandlers {
  onImages(images: UploadedImage[]): void;
  onReads(reads: LabelRead[]): void;
  onError(message: string): void;
  onTimeout(pending: number): void;
}

export interface OcrWatcherOptions {
  getAccessToken: () => string | null;
  handlers: OcrWatcherHandlers;
}

/**
 * Follows a batch of uploaded images until the OCR has finished with each one.
 *
 * An image is finished when the API says so (`ocr_status`). Against an API that
 * predates that field, it is finished once a read with label data shows up, so
 * the watcher keeps working across a staggered deployment.
 */
export class OcrWatcher {
  private readonly getAccessToken: () => string | null;
  private readonly handlers: OcrWatcherHandlers;
  private generation = 0;

  constructor(options: OcrWatcherOptions) {
    this.getAccessToken = options.getAccessToken;
    this.handlers = options.handlers;
  }

  /** Stops whatever is being followed, for example when the results are cleared. */
  cancel(): void {
    this.generation++;
  }

  async watch(imageIDs: string[]): Promise<void> {
    const pending = new Set(imageIDs);
    if (pending.size === 0) return;

    const generation = ++this.generation;
    const deadline = Date.now() + Math.min(Math.max(MIN_WAIT_MS, pending.size * PER_IMAGE_WAIT_MS), MAX_WAIT_MS);

    while (Date.now() < deadline && generation === this.generation) {
      const token = this.getAccessToken();
      if (!token) return;

      const ids = Array.from(pending);
      for (let start = 0; start < ids.length; start += BATCH_SIZE) {
        await this.poll(ids.slice(start, start + BATCH_SIZE), token, pending);
        if (generation !== this.generation) return;
      }
      if (pending.size === 0) return;

      await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (generation !== this.generation) return;
    this.handlers.onTimeout(pending.size);
  }

  /**
   * Images are fetched before reads on purpose: the backend stores a result's
   * fields before it marks the image done, so reads fetched afterwards can never
   * be older than the state that just settled the image.
   */
  private async poll(ids: string[], token: string, pending: Set<string>): Promise<void> {
    let images: UploadedImage[] = [];
    try {
      images = await imagesApi.listImagesByIDs(ids, token);
      this.handlers.onImages(images);
    } catch (error) {
      this.handlers.onError(errorMessage(error, "No se pudo consultar el estado de las imágenes."));
    }

    let reads: LabelRead[] = [];
    try {
      reads = await readsApi.listReadsForImages(ids, token);
      this.handlers.onReads(reads);
    } catch (error) {
      this.handlers.onError(errorMessage(error, "No se pudo actualizar el lote OCR."));
    }

    const imagesByID = new Map(images.map((image) => [image.id, image]));
    const readImageIDs = new Set(reads.filter(hasLabelFields).map((read) => read.image_id));

    for (const id of ids) {
      const status = imagesByID.get(id)?.ocr_status;
      const finished = status !== undefined ? isOcrSettled(status) : readImageIDs.has(id);
      if (finished) pending.delete(id);
    }
  }
}

export function hasLabelFields(read: LabelRead): boolean {
  return Boolean(read.destino || read.codigo_postal || read.destinatario || read.tracking || read.direccion);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
