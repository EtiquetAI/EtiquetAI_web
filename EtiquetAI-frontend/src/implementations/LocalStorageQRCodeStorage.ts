import { QRCodeStorage } from "../abstracts/QRCodeStorage.js";

const STORAGE_KEY = "qr_scanner_detected_codes";

export class LocalStorageQRCodeStorage extends QRCodeStorage {
  async save(code: string): Promise<void> {
    const list = await this.list();
    if (!list.includes(code)) {
      list.unshift(code);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
    }
  }

  async list(): Promise<string[]> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch (e) {
      return [];
    }
  }
}
