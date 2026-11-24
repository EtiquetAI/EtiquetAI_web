import type { LabelRead } from "../../src/api/reads.js";
import { test, expect, ocrRead, restoreSession } from "./fixtures";

const reviewRead: LabelRead = {
  ...ocrRead,
  direccion: "Av. Rivadavia 4521",
  validation_status: "REVIEW",
  issues: ["missing_tracking"],
  confidence: { destinatario: 0.9 },
  review_status: "pending",
};

async function openDetail(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await page.getByRole("button", { name: "Ver detalle del resultado 1", exact: true }).click();
}

test("shows the original image beside the fields and saves a correction", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await openDetail(page);

  await expect(page.locator(".review-image img")).toBeVisible();
  const name = page.locator("#review-read-test-destinatario");
  await expect(name).toHaveValue("ANA TEST");
  await expect(page.locator("#review-read-test-tracking").locator("xpath=..")).toHaveClass(/is-doubtful/);

  await name.fill("ANA TESTA");
  await page.getByRole("button", { name: "Guardar correcciones", exact: true }).click();

  const patches = api.matching("PATCH", "/api/v1/reads/read-test");
  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0].postData() ?? "{}")).toEqual({ destinatario: "ANA TESTA" });
  await expect(page.locator("#resultsTableBody .col-review .review-badge")).toHaveAttribute("data-review", "corrected");
  await expect(page.locator(".is-corrections")).toContainText("ANA TEST");
});

test("confirms a reading without changing it", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await openDetail(page);

  await page.getByRole("button", { name: "Confirmar lectura", exact: true }).click();

  const patches = api.matching("PATCH", "/api/v1/reads/read-test");
  expect(JSON.parse(patches[0].postData() ?? "{}")).toEqual({ confirm: true });
  await expect(page.locator("#resultsTableBody .col-review .review-badge")).toHaveAttribute("data-review", "confirmed");
});

test("filters the results on the server", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();

  await page.locator("#resultsFilterValidation").selectOption("REVIEW");

  await expect.poll(() => api.matching("GET", "/api/v1/reads").some((request) => new URL(request.url()).searchParams.get("validation_status") === "REVIEW")).toBe(true);
});

test("downloads the CSV built by the server", async ({ page, api }) => {
  api.reads = [{ ...reviewRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();

  const downloadEvent = page.waitForEvent("download");
  await page.locator("#exportCsvButton").click();
  const download = await downloadEvent;

  expect(download.suggestedFilename()).toBe("etiquetai-lecturas.csv");
  expect(api.matching("GET", "/api/v1/reads/export")).toHaveLength(1);
});

test("unpacks a zip and lists what it left out", async ({ page, api }) => {
  api.batchResult = {
    batch_id: "batch-test",
    total: 2,
    accepted: [{ id: "image-test", filename: "uno.png", mime_type: "image/png", size_bytes: 10, status: "processed", created_at: ocrRead.created_at, batch_id: "batch-test", ocr_status: "done" }],
    rejected: [{ filename: "notas.txt", reason: "not_an_image" }],
  };
  api.images = [{ id: "image-test", filename: "uno.png", mime_type: "image/png", size_bytes: 10, status: "processed", created_at: ocrRead.created_at, batch_id: "batch-test", ocr_status: "done" }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();

  await page.locator("#imageInput").setInputFiles({ name: "lote.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });

  await expect(page.locator("#uploadBatchReport")).toContainText("1 de 2 imágenes aceptadas");
  await expect(page.locator("#uploadBatchReport")).toContainText("notas.txt: no es una imagen válida");
  expect(api.matching("POST", "/api/v1/images/batch")).toHaveLength(1);
});

test("shows the processing metrics", async ({ page }) => {
  await restoreSession(page);

  await page.getByRole("button", { name: "Métricas", exact: true }).click();

  await expect(page.locator('[data-metric="correction-rate"] .metric-value')).toHaveText("100%");
  await expect(page.locator('[data-metric="processed"] .metric-value')).toHaveText("2");
});
