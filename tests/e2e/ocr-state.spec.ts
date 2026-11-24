import type { LabelRead } from "../../src/api/reads.js";
import { test, expect, ocrRead, pngFile, restoreSession } from "./fixtures";

const reviewRead: LabelRead = {
  ...ocrRead,
  direccion: "Av. Rivadavia 4521",
  qr_raw: "AR123456789|1424",
  qr_tracking: "AR123456789",
  qr_codigo_postal: "1424",
  validation_status: "REVIEW",
  issues: ["postal_code_mismatch", "low_confidence_destinatario", "some_future_code"],
  confidence: { destinatario: 0.42, tracking: 0.93, codigo_postal: 0.71 },
  engine: "tesseract",
  ocr_text: "DESTINATARIO: ANA TEST\nCP: 2000",
};

function idsPolls(api: { matching: (method: string, path: string) => import("@playwright/test").Request[] }) {
  return api.matching("GET", "/api/v1/images").filter((request) => new URL(request.url()).searchParams.has("ids"));
}

test("follows an image from the queue until the OCR has read it", async ({ page, api }) => {
  api.ocrStates = [
    { ocr_status: "queued" },
    { ocr_status: "done", validation_status: "REVIEW", ocr_engine: "tesseract" },
  ];
  api.ocrResult = { ...reviewRead };
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await page.locator("#imageInput").setInputFiles(pngFile);

  await expect(page.locator("#uploadedList")).toContainText("Esperando OCR…");
  await expect(page.locator("#uploadedList")).toContainText("Leída · revisar", { timeout: 15000 });
  await expect(page.locator("#uploadedList .uploaded-item-ocr")).toHaveAttribute("data-ocr-status", "done");

  const polls = idsPolls(api);
  expect(polls.length).toBe(2);
  expect(new URL(polls[0].url()).searchParams.get("ids")).toBe("image-test");
});

test("stops following an image as soon as the OCR gives up on it", async ({ page, api }) => {
  api.ocrStates = [{ ocr_status: "failed", validation_status: "REJECTED", ocr_error: "tesseract exploded" }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await page.locator("#imageInput").setInputFiles(pngFile);

  await expect(page.locator("#uploadedList")).toContainText("El OCR falló");
  await expect(page.locator("#uploadedList .uploaded-item-ocr")).toHaveAttribute("title", "tesseract exploded");
  await page.waitForTimeout(3500);
  expect(idsPolls(api)).toHaveLength(1);
});

test("tells apart an image the queue never received", async ({ page, api }) => {
  api.ocrStates = [{ ocr_status: "not_queued", ocr_error: "the image could not be queued for OCR" }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await page.locator("#imageInput").setInputFiles(pngFile);

  await expect(page.locator("#uploadedList")).toContainText("No se pudo encolar");
  expect(idsPolls(api)).toHaveLength(1);
});

test("reports an image that was read but is not a shipping label", async ({ page, api }) => {
  api.ocrStates = [{ ocr_status: "done", validation_status: "REJECTED" }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await page.locator("#imageInput").setInputFiles(pngFile);

  await expect(page.locator("#uploadedList")).toContainText("Sin etiqueta legible");
  expect(idsPolls(api)).toHaveLength(1);
});

test("resumes following images that were still waiting when the session started", async ({ page, api }) => {
  api.images = [
    {
      id: "image-test", filename: "label.png", mime_type: "image/png", size_bytes: 68,
      status: "processed", created_at: ocrRead.created_at, ocr_status: "queued",
    },
  ];
  api.ocrStates = [
    { ocr_status: "queued" },
    { ocr_status: "done", validation_status: "OK" },
  ];
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();

  await expect(page.locator("#uploadedList")).toContainText("Leída", { timeout: 15000 });
  expect(idsPolls(api).length).toBeGreaterThanOrEqual(2);
});

test("shows the verdict, the address and an expandable explanation for each reading", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();

  const row = page.locator("#resultsTableBody").getByRole("row");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".status-badge")).toHaveText("Revisar");
  await expect(row.locator(".status-badge")).toHaveAttribute("data-status", "REVIEW");
  await expect(page.getByRole("cell", { name: "Av. Rivadavia 4521", exact: true })).toBeVisible();

  const toggle = page.getByRole("button", { name: "Ver detalle del resultado 1", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();

  await expect(page.locator("#resultsTableBody").getByRole("row")).toHaveCount(2);
  const detail = page.locator(".result-detail");
  await expect(detail).toContainText("El código postal leído no coincide con el del QR.");
  await expect(detail).toContainText("La lectura de «Destinatario» tiene poca confianza.");
  await expect(detail).toContainText("some_future_code");
  await expect(detail.locator(".confidence-item.is-low")).toContainText("42%");
  await expect(detail.locator(".confidence-item.is-high")).toContainText("93%");
  await expect(detail).toContainText("AR123456789|1424");
  await expect(detail).toContainText("DESTINATARIO: ANA TEST");

  await page.getByRole("button", { name: "Ocultar detalle del resultado 1", exact: true }).click();
  await expect(page.locator("#resultsTableBody").getByRole("row")).toHaveCount(1);
});

test("shows no verdict for a reading nobody has judged, yet lets a person open it to review", async ({ page, api }) => {
  api.reads = [{ ...ocrRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();

  await expect(page.locator("#resultsTableBody .status-badge")).toHaveText("—");
  // An image reading can always be checked and corrected, whatever the OCR said about it.
  await expect(page.getByRole("button", { name: /detalle del resultado/ })).toHaveCount(1);
});

test("keeps the detail panel closed after a row is removed", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await page.getByRole("button", { name: "Ver detalle del resultado 1", exact: true }).click();
  await expect(page.locator(".result-detail")).toBeVisible();

  await page.getByRole("button", { name: "Borrar resultado 1", exact: true }).click();

  await expect(page.locator("#resultsCount")).toHaveText("0 etiquetas");
  await expect(page.locator(".result-detail")).toHaveCount(0);
});

test("puts the verdict, the address and the reasons in the Excel export", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();

  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar Excel" }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const workbook = Buffer.concat(chunks).toString("utf8");

  for (const expected of [
    "Estado",
    "Motivos",
    "Dirección",
    "Revisar",
    "Av. Rivadavia 4521",
    "El código postal leído no coincide con el del QR.",
    "AR123456789|1424",
  ]) {
    expect(workbook, expected).toContain(expected);
  }
});
