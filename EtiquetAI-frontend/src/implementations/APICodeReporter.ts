import { QRCodeReporter } from "../abstracts/QRCodeReporter.js";

export class APICodeReporter extends QRCodeReporter {
  private url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  async report(code: string): Promise<void> {
    if (!this.url) return;
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, timestamp: new Date().toISOString() })
      });
    } catch (e) {
      console.error("Failed to report code:", e);
      throw e;
    }
  }
}
