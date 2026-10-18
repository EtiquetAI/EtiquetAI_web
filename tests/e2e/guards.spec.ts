import { test, API_ORIGIN } from "./fixtures";

// These negative tests must fail in fixture teardown. Playwright flags an
// unexpected pass if the network guard silently accepts the injected failure.
test("guard rejects an unexpected abort after an expected HTTP error at the same URL", async ({ page, context, api }) => {
  test.fail();
  await page.goto("/");
  api.loginStatus = 401;
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/api/v1/auth/login`, { method: "POST" });
  }, API_ORIGIN);
  api.loginStatus = 200;
  await context.route(`${API_ORIGIN}/api/v1/auth/login`, (route) => route.abort("failed"));
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/api/v1/auth/login`, { method: "POST" }).catch(() => {});
  }, API_ORIGIN);
});

test("guard rejects a second unexpected abort after an intentionally aborted request", async ({ page, context, api }) => {
  test.fail();
  await page.goto("/");
  api.abortLogin = true;
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/api/v1/auth/login`, { method: "POST" }).catch(() => {});
  }, API_ORIGIN);
  await context.route(`${API_ORIGIN}/api/v1/auth/login`, (route) => route.abort("failed"));
  await page.evaluate(async (origin) => {
    await fetch(`${origin}/api/v1/auth/login`, { method: "POST" }).catch(() => {});
  }, API_ORIGIN);
});
