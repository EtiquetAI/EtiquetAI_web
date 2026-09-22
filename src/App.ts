import { Scanner } from "./abstracts/Scanner.js";
import { QRCodeStorage } from "./abstracts/QRCodeStorage.js";
import { QRCodeReporter } from "./abstracts/QRCodeReporter.js";
import { APICodeReporter } from "./implementations/APICodeReporter.js";

export class App {
  private scanner: Scanner;
  private storage: QRCodeStorage;
  private codesListEl: HTMLUListElement;
  private startBtn: HTMLButtonElement;
  private stopBtn: HTMLButtonElement;
  private backendUrlEl: HTMLInputElement | null = null;
  private enableReportEl: HTMLInputElement | null = null;
  private reportStatusEl: HTMLDivElement | null = null;
  private reporter: QRCodeReporter | null = null;

  constructor(scanner: Scanner, storage: QRCodeStorage) {
    this.scanner = scanner;
    this.storage = storage;
    this.codesListEl = document.getElementById("codesList") as HTMLUListElement;
    this.startBtn = document.getElementById("startBtn") as HTMLButtonElement;
    this.stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;

    this.scanner.setDetectedCallback(async (code) => {
      await this.storage.save(code);
      this.refreshList();
      // report if enabled
      if (this.enableReportEl?.checked) {
        const url = this.backendUrlEl?.value || "";
        if (url) {
          if (!this.reporter || (this.reporter instanceof APICodeReporter && (this.reporter as APICodeReporter)["url"] !== url)) {
            this.reporter = new APICodeReporter(url);
          }
          try {
            await this.reporter.report(code);
            if (this.reportStatusEl) this.reportStatusEl.textContent = `Último enviado: ${code} `;
          } catch (e) {
            if (this.reportStatusEl) this.reportStatusEl.textContent = `Error al enviar: ${e}`;
          }
        }
      }
    });

    this.startBtn.addEventListener("click", async () => {
      try {
        await this.scanner.start();
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;
      } catch (e) {
        alert("No se pudo iniciar la cámara: " + e);
      }
    });

    this.stopBtn.addEventListener("click", () => {
      this.scanner.stop();
      this.startBtn.disabled = false;
      this.stopBtn.disabled = true;
    });

    this.backendUrlEl = document.getElementById("backendUrl") as HTMLInputElement | null;
    this.enableReportEl = document.getElementById("enableReport") as HTMLInputElement | null;
    this.reportStatusEl = document.getElementById("reportStatus") as HTMLDivElement | null;

    this.refreshList();
  }

  stop(): void {
    this.scanner.stop();
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;
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
