import { QRCodeStorage } from "../abstracts/QRCodeStorage.js";

const STORAGE_PREFIX = "qr_scanner_detected_codes";
/** Before codes were kept per account, every account of a browser shared this one key. */
const LEGACY_KEY = STORAGE_PREFIX;

/**
 * The scanner's list of detected codes, kept in the browser **per account**.
 *
 * It used to live under a single key, so whoever signed in next saw the codes the previous
 * person had scanned. The key now carries the account's id, and without a signed-in account
 * nothing is read or written.
 */
export class LocalStorageQRCodeStorage extends QRCodeStorage {
  constructor(private readonly getUserId: () => string | null) {
    super();
  }

  /** Drops the shared list of the old versions: it cannot be told to whom its codes belong. */
  purgeLegacy(): void {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // Storage may be unavailable (private mode); there is then nothing to purge.
    }
  }

  private key(): string | null {
    const id = this.getUserId();
    return id ? `${STORAGE_PREFIX}:${id}` : null;
  }

  async save(code: string): Promise<void> {
    const key = this.key();
    if (key === null) return;
    const list = await this.list();
    if (!list.includes(code)) {
      list.unshift(code);
      localStorage.setItem(key, JSON.stringify(list.slice(0, 200)));
    }
  }

  async list(): Promise<string[]> {
    const key = this.key();
    if (key === null) return [];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
}
