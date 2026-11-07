import { imagesApi } from "../api/images.js";

/**
 * Blob URLs of original images, one fetch per image. The results table redraws
 * often, and fetching the picture again on every redraw would flicker and waste
 * the connection. `clear` frees everything, for example on logout.
 */
const urls = new Map<string, Promise<string>>();

export function loadImageUrl(imageId: string, accessToken: string): Promise<string> {
  let pending = urls.get(imageId);
  if (pending === undefined) {
    pending = imagesApi.fetchImageObjectUrl(imageId, accessToken);
    urls.set(imageId, pending);
    // A failed fetch must not be remembered: the next attempt should try again.
    pending.catch(() => urls.delete(imageId));
  }
  return pending;
}

export function clearImageCache(): void {
  for (const pending of urls.values()) {
    pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  urls.clear();
}
