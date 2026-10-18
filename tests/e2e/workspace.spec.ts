import { test, expect, ocrRead, pngFile, restoreSession, tokens } from "./fixtures";

test("navigates between sections and shows an empty results state", async ({ page }) => {
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cargar imagen de etiqueta" })).toBeVisible();
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await expect(page.locator("#resultsTableStatus")).toContainText("Todavía no hay etiquetas guardadas.");
  await expect(page.getByRole("button", { name: "Descargar Excel" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Borrar resultados", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Escanear QR", exact: true }).click();
  await expect(page.getByRole("button", { name: "Iniciar cámara" })).toBeVisible();
});

test("uploads an image, previews it, and polls until OCR fields appear", async ({ page, api }) => {
  api.ocrResult = { ...ocrRead };
  api.emptyPolls = 1;
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await page.locator("#imageInput").setInputFiles(pngFile);
  await expect(page.getByAltText("Vista previa de la imagen seleccionada")).toBeVisible();
  await expect(page.locator("#uploadPreviewCaption")).toContainText("label.png");
  await expect(page.locator("#uploadStatus")).toContainText("Se cargaron 1 imagen(es).");
  const upload = api.matching("POST", "/api/v1/images")[0];
  expect(upload.headers().authorization).toBe(`Bearer ${tokens.access_token}`);
  expect(upload.headers()["content-type"]).toContain("multipart/form-data; boundary=");
  expect(upload.postDataBuffer()?.toString()).toContain('name="file"; filename="label.png"');
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await expect(page.getByRole("cell", { name: "ROSARIO", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "ANA TEST", exact: true })).toHaveText("ANA TEST");
  await expect(page.getByRole("cell", { name: "2000", exact: true })).toHaveText("2000");
  await expect(page.getByRole("cell", { name: "AR123456789", exact: true })).toHaveText("AR123456789");
  const polls = api.matching("GET", "/api/v1/reads").filter((request) => new URL(request.url()).searchParams.has("image_ids"));
  expect(polls.length).toBeGreaterThanOrEqual(2);
  expect(new URL(polls[0].url()).searchParams.get("image_ids")).toBe("image-test");
});

for (const invalid of [
  { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("not an image"), message: "Solo se aceptan imágenes JPG o PNG." },
  { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0), message: "El archivo está vacío." },
  { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1), message: "La imagen supera el límite de 10 MB." },
]) {
  test(`rejects ${invalid.name} without sending an upload request`, async ({ page, api }) => {
    await restoreSession(page);
    await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
    await page.locator("#imageInput").setInputFiles({ name: invalid.name, mimeType: invalid.mimeType, buffer: invalid.buffer });
    await expect(page.locator("#uploadStatus")).toContainText(invalid.message);
    expect(api.matching("POST", "/api/v1/images")).toHaveLength(0);
  });
}

test("shows an upload rejected by the API", async ({ page, api }) => {
  api.uploadStatus = 400;
  await restoreSession(page);
  await page.getByRole("button", { name: "Ingresar imagen", exact: true }).click();
  await page.locator("#imageInput").setInputFiles(pngFile);
  await expect(page.locator("#uploadStatus")).toHaveText("1 imagen(es) no se pudieron cargar.");
  await expect(page.locator("#uploadedList").getByRole("listitem")).toHaveCount(0);
});

test("preserves visible results after a failed refresh", async ({ page, api }) => {
  api.reads = [{ ...ocrRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await expect(page.locator("#resultsTableBody").getByRole("row")).toHaveCount(1);
  api.readsStatus = 500;
  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.locator("#resultsTableStatus")).not.toBeEmpty();
  await expect(page.locator("#resultsTableStatus")).toHaveClass(/is-error/);
  await expect(page.locator("#resultsTableBody")).toContainText("ROSARIO");
  await expect(page.getByRole("button", { name: "Actualizar", exact: true })).toBeEnabled();
});

test("downloads an Excel workbook for the displayed results", async ({ page, api }) => {
  api.reads = [{ ...ocrRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar Excel" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^etiquetas-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const workbook = Buffer.concat(chunks);
  expect(workbook.subarray(0, 2).toString()).toBe("PK");
  await expect(page.locator("#resultsTableStatus")).toHaveText("Archivo generado con 1 filas.");
});

test("removes a single result through the API", async ({ page, api }) => {
  api.reads = [{ ...ocrRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await page.getByRole("button", { name: "Borrar resultado 1", exact: true }).click();
  await expect(page.locator("#resultsCount")).toHaveText("0 etiquetas");
  expect(api.matching("DELETE", "/api/v1/reads/read-test")).toHaveLength(1);
});

test("keeps a row when deletion fails", async ({ page, api }) => {
  api.reads = [{ ...ocrRead }];
  api.deleteStatus = 500;
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await page.getByRole("button", { name: "Borrar resultado 1", exact: true }).click();
  await expect(page.locator("#resultsTableStatus")).toHaveClass(/is-error/);
  await expect(page.locator("#resultsCount")).toHaveText("1 etiqueta");
  await expect(page.getByRole("button", { name: "Borrar resultado 1", exact: true })).toBeEnabled();
});

test("requires confirmation before deleting all results", async ({ page, api }) => {
  api.reads = [{ ...ocrRead }];
  await restoreSession(page);
  await page.getByRole("button", { name: "Resultados", exact: true }).click();
  await expect(page.locator("#resultsCount")).toHaveText("1 etiqueta");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Borrar resultados", exact: true }).click();
  expect(api.matching("DELETE", "/api/v1/reads")).toHaveLength(0);
  await expect(page.locator("#resultsCount")).toHaveText("1 etiqueta");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Borrar resultados", exact: true }).click();
  await expect(page.locator("#resultsCount")).toHaveText("0 etiquetas");
  expect(api.matching("DELETE", "/api/v1/reads")).toHaveLength(1);
});
