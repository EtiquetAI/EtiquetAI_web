export abstract class QRCodeStorage {
  abstract save(code: string): Promise<void>;
  abstract list(): Promise<string[]>;
}
