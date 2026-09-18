export abstract class QRCodeReporter {
  abstract report(code: string): Promise<void>;
}
