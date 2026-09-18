"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APICodeReporter = void 0;
const QRCodeReporter_js_1 = require("../abstracts/QRCodeReporter.js");
class APICodeReporter extends QRCodeReporter_js_1.QRCodeReporter {
    constructor(url) {
        super();
        this.url = url;
    }
    async report(code) {
        if (!this.url)
            return;
        try {
            await fetch(this.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, timestamp: new Date().toISOString() })
            });
        }
        catch (e) {
            console.error("Failed to report code:", e);
            throw e;
        }
    }
}
exports.APICodeReporter = APICodeReporter;
