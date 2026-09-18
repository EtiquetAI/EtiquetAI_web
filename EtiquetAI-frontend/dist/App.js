"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = void 0;
const APICodeReporter_js_1 = require("./implementations/APICodeReporter.js");
class App {
    constructor(scanner, storage) {
        this.backendUrlEl = null;
        this.enableReportEl = null;
        this.reportStatusEl = null;
        this.reporter = null;
        this.scanner = scanner;
        this.storage = storage;
        this.codesListEl = document.getElementById("codesList");
        this.startBtn = document.getElementById("startBtn");
        this.stopBtn = document.getElementById("stopBtn");
        this.scanner.setDetectedCallback(async (code) => {
            var _a, _b;
            await this.storage.save(code);
            this.refreshList();
            // report if enabled
            if ((_a = this.enableReportEl) === null || _a === void 0 ? void 0 : _a.checked) {
                const url = ((_b = this.backendUrlEl) === null || _b === void 0 ? void 0 : _b.value) || "";
                if (url) {
                    if (!this.reporter || (this.reporter instanceof APICodeReporter_js_1.APICodeReporter && this.reporter["url"] !== url)) {
                        this.reporter = new APICodeReporter_js_1.APICodeReporter(url);
                    }
                    try {
                        await this.reporter.report(code);
                        if (this.reportStatusEl)
                            this.reportStatusEl.textContent = `Último enviado: ${code} `;
                    }
                    catch (e) {
                        if (this.reportStatusEl)
                            this.reportStatusEl.textContent = `Error al enviar: ${e}`;
                    }
                }
            }
        });
        this.startBtn.addEventListener("click", async () => {
            try {
                await this.scanner.start();
                this.startBtn.disabled = true;
                this.stopBtn.disabled = false;
            }
            catch (e) {
                alert("No se pudo iniciar la cámara: " + e);
            }
        });
        this.stopBtn.addEventListener("click", () => {
            this.scanner.stop();
            this.startBtn.disabled = false;
            this.stopBtn.disabled = true;
        });
        this.backendUrlEl = document.getElementById("backendUrl");
        this.enableReportEl = document.getElementById("enableReport");
        this.reportStatusEl = document.getElementById("reportStatus");
        this.refreshList();
    }
    async refreshList() {
        const codes = await this.storage.list();
        this.codesListEl.innerHTML = "";
        for (const c of codes) {
            const li = document.createElement("li");
            li.textContent = c;
            this.codesListEl.appendChild(li);
        }
    }
}
exports.App = App;
