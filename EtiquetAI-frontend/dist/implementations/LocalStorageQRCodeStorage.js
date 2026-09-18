"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStorageQRCodeStorage = void 0;
const QRCodeStorage_js_1 = require("../abstracts/QRCodeStorage.js");
const STORAGE_KEY = "qr_scanner_detected_codes";
class LocalStorageQRCodeStorage extends QRCodeStorage_js_1.QRCodeStorage {
    async save(code) {
        const list = await this.list();
        if (!list.includes(code)) {
            list.unshift(code);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 200)));
        }
    }
    async list() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw)
                return [];
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed))
                return parsed;
            return [];
        }
        catch (e) {
            return [];
        }
    }
}
exports.LocalStorageQRCodeStorage = LocalStorageQRCodeStorage;
