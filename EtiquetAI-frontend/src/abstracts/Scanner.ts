export type DetectedCallback = (code: string) => void;

export abstract class Scanner {
  protected onDetected?: DetectedCallback;

  setDetectedCallback(cb: DetectedCallback) {
    this.onDetected = cb;
  }

  abstract start(): Promise<void>;
  abstract stop(): void;
}
