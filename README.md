# EtiquetAI Web

EtiquetAI is a Vite and TypeScript frontend for scanning QR codes from a browser camera, uploading label images for server-side decoding, and reviewing both in a results table backed by the API database. Authentication uses the EtiquetAI Go API with JWT bearer tokens.

## Requirements

- Node.js 20.19+ or 22.12+.
- npm.
- A browser that supports camera access. Camera access may require a secure context when deployed.

## Development

Install dependencies and start the Vite development server from the repository root:

```bash
npm install
npm run dev
```

Set the backend URL before starting the development server:

```text
VITE_API_BASE_URL=http://localhost:8080
```

The same value can be stored in `.env.local`. The authentication screen starts at login and switches between login and registration without routing. The frontend sends registration requests to `POST /api/v1/auth/register` with `name`, `email`, `password`, and an optional `phone_number`, then returns to login with the registered email prefilled. Registration does not create a session because the backend returns a user but no tokens.

Login uses `POST /api/v1/auth/login`, validates the session with `GET /api/v1/users/me`, and stores the access and refresh tokens in `sessionStorage` only. On reload, the frontend restores the JWT session and refreshes it through the backend when the access token has expired.

## Authenticated workspace

After login the app renders a single workspace with a three-tab navigation bar. Each tab swaps the active panel and updates the page title.

| Tab | Panel | Behaviour |
| --- | --- | --- |
| Escanear QR | `#appPage` scanner | Camera preview, live detection, and the recent scans list. Starting a scan stops whatever else was running. |
| Ingresar imagen | upload panel | Drag-and-drop or file picker with an inline preview. Uploads via `POST /api/v1/images`, then follows each image through the OCR and shows where it is (see *OCR progress* below). |
| Resultados | results table | Reads `GET /api/v1/reads` and renders `#`, `Fecha`, `Estado`, `Destino`, `Código postal`, `Destinatario`, `Dirección`, `Tracking`, `Contenido`, `Origen`, and `Archivo`. A `Detalle` button opens the reasons, confidence, QR and raw OCR text of a reading. |

The results table is not persisted in the browser. Every row comes from the `label_reads` table through the API, scoped to the logged-in user, so reloads and other devices see the same data. The origin column shows `Cámara` or `Imagen` depending on how the value was captured, and a failed refresh leaves the current rows in place while showing an error status.

`Descargar Excel` builds the `.xlsx` file in the browser with no third-party spreadsheet dependency and triggers a download. It carries the same columns as the table plus the reasons (`Motivos`) and the decoded QR. `Actualizar` re-fetches the current page.

### OCR progress

An upload only says the image was stored. What happens next is reported by the API (`ocr_status` on `GET /api/v1/images`) and the panel shows it under each image:

| `ocr_status` | Shown as | Meaning |
| --- | --- | --- |
| `queued` | Esperando OCR… | Handed to the vision worker; no result yet. |
| `done` + `validation_status` `OK` / `REVIEW` / `REJECTED` | Leída / Leída · revisar / Sin etiqueta legible | The worker answered. |
| `failed` | El OCR falló | The worker reported an error (its message is the tooltip). |
| `not_queued` | No se pudo encolar | The broker refused the job; the image is stored but will not be read. |
| `disabled` | OCR desactivado | The backend runs without a queue. |
| `unknown` or absent | nothing | Images stored before this was tracked, or an API that predates it. |

`OcrWatcher` (`src/ocr/OcrWatcher.ts`) polls `GET /api/v1/images?ids=…` and `GET /api/v1/reads?image_ids=…` every 2.5 s until every image of the batch has finished, giving up after 15–120 s depending on the batch size. It stops following an image the moment its state is final, so a failure no longer waits for a timeout. Images still `queued` when the page loads are followed again. Images are fetched before reads on purpose: the backend stores a result's fields before it marks the image done, so the reads fetched afterwards are never older than the state that finished the image. Against an API without `ocr_status` it falls back to the previous rule (finished once a read with label data appears).

### Verdict of a reading

Each row of the results table carries the vision service's verdict, shown by `src/results/StatusBadge.ts`:

| `validation_status` | Badge | Meaning |
| --- | --- | --- |
| `OK` | Correcta | Required fields read with good confidence and no conflict with the QR. |
| `REVIEW` | Revisar | Something is doubtful and a person should confirm it. |
| `REJECTED` | Rechazada | No shipping label could be read in the image. |
| absent | — | Camera scans, which no OCR has judged. |

`Detalle` explains the verdict. Issue codes are translated in `src/results/status.ts` (`describeIssue`); a code the frontend does not know yet is shown as it arrives, so a new backend code never hides information. Confidence is graded high (≥ 80 %), medium (≥ 50 %) or low.

Every field added with version 1 of the API contract is optional in `src/api/reads.ts` and `src/api/images.ts`, so the frontend keeps working against a backend that has not been updated.

The scanner panel also keeps the optional reporting adapter: when `Enviar cada lectura` is enabled under `Configurar envío`, each detected code is additionally posted to the `Backend URL` entered there through the browser `fetch` API. This is independent of the results table, which always reads from `GET /api/v1/reads`.

## Build

Run strict, no-emit TypeScript validation followed by the Vite production build:

```bash
npm run build
```

The generated production files are written to `dist/`. The directory is generated by Vite and is ignored by Git.

## Browser tests (Playwright)

Install the browser once, then run the suite from this repository:

```bash
npm ci
npx playwright install chromium
npm run test:e2e:types
npm run test:e2e
```

On Linux CI, use `npx playwright install --with-deps chromium` when system browser
dependencies are not already installed. For interactive debugging use
`npm run test:e2e:ui`. View the last HTML report with `npm run test:e2e:report`.

The same 36 application scenarios run in desktop Chrome and mobile Chromium emulation:
registration/login errors and success, session restore/refresh/logout, navigation,
image preview/upload, file validation, delayed OCR result polling, OCR progress
(queued, done, failed, not queued, rejected, resumed after a reload), the verdict
badge and expandable detail of a reading, result refresh failures, Excel downloads
(including verdict and reasons), and single/bulk deletion (including
cancellation/errors). `tests/e2e/vision-vocabulary.spec.ts` covers the pure
vocabulary (status parsing, issue messages, confidence grading, snapshot merging)
without opening a page.
Two additional negative guard scenarios deliberately trigger fixture failures:
Playwright marks them as expected failures and rejects an unexpected pass.

`playwright.config.ts` starts a dedicated Vite server on `127.0.0.1:4173` with a
test API origin at `127.0.0.1:4174`; both ports should be free. API calls are
intercepted in `tests/e2e/fixtures.ts`, external font requests are fulfilled locally,
and unexpected requests fail the suite. No Go, Vision, Docker, credentials, or
production access is needed. Each test gets a fresh browser context and session.
Traces and screenshots are retained on failure; generated reports and test results
are ignored by Git. CI rejects focused tests (`test.only`), and retries are disabled
so failures are visible.

These tests exercise the frontend with simulated backend/OCR responses. They do not
evaluate recognition accuracy, camera hardware, or real RabbitMQ persistence. The
Go repository's `./scripts/test-integration-local.sh` covers the local service
pipeline separately; that is not run by `npm run test:e2e`.

## Preview

Serve the production build locally with Vite:

```bash
npm run preview
```

## Deploy on Vercel

Deploy the repository root as a Vite project. Do not configure a custom **Root Directory**. Set this Vercel environment variable:

```text
VITE_API_BASE_URL=https://etiquetai-go.onrender.com
```

The backend must also allow the deployed frontend origin through its `CORS_ALLOWED_ORIGINS` configuration. Use `https://etiquet-ai-web.vercel.app` in production and include `http://localhost:5173` for local development when needed.

Use the following build settings:

- **Build Command:** `npm run build`
- **Output Directory:** `dist`

The root `vercel.json` contains the same build settings and rewrites extensionless, non-asset paths to `/index.html` for the single-page application. Requests under `/assets/` and requests ending in a file extension are excluded from the rewrite so JavaScript, CSS, and other generated assets are served normally.

After registration, the frontend returns to the login form without storing the password. After login, it validates the returned bearer token against the current-user endpoint. Concurrent restore attempts share the same refresh request, refresh token rotation replaces both stored tokens, and a failed refresh clears the local session. Logout calls the backend and always clears the local session, including when the request cannot reach the server.
