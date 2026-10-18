import { test, expect, openLogin, restoreSession, tokens, user } from "./fixtures";

test("logs in, disables submission while pending, and opens the workspace", async ({ page, api }) => {
  let release = () => {};
  api.loginGate = new Promise<void>((resolve) => { release = resolve; });
  await openLogin(page);
  await page.locator("#loginButton").click();
  await expect(page.locator("#loginButton")).toBeDisabled();
  await expect(page.locator("#loginButton")).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page.getByRole("heading", { name: "Escanear QR", exact: true })).toBeVisible();
  expect(api.matching("POST", "/api/v1/auth/login")[0].postDataJSON()).toEqual({
    email: user.email, password: "test-password-123",
  });
  expect(await page.evaluate(() => sessionStorage.getItem("access_token"))).toBe(tokens.access_token);
});

test("shows bad credentials without creating a session", async ({ page, api }) => {
  api.loginStatus = 401;
  await openLogin(page);
  await page.locator("#loginButton").click();
  await expect(page.locator("#loginError")).toHaveText("Email o contraseña incorrectos.");
  await expect(page.locator("#loginButton")).toBeEnabled();
  await expect(page.locator("#password")).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("access_token"))).toBeNull();
});

test("handles a login network failure and allows another attempt", async ({ page, api }) => {
  api.abortLogin = true;
  await openLogin(page);
  await page.locator("#loginButton").click();
  await expect(page.locator("#loginError")).toContainText("No se pudo conectar con el servidor.");
  await expect(page.locator("#loginButton")).toBeEnabled();
});

for (const duplicate of [false, true]) {
  test(duplicate ? "reports an already registered email" : "registers and returns to login without creating a session", async ({ page, api }) => {
    if (duplicate) api.registrationStatus = 409;
    await page.goto("/");
    await page.locator("#landingRegisterButton").click();
    await expect(page.locator("#registerName")).toBeFocused();
    await page.locator("#registerName").fill(user.name);
    await page.locator("#registerEmail").fill(user.email);
    await page.locator("#registerPassword").fill("test-password-123");
    await page.locator("#registerPasswordConfirmation").fill("test-password-123");
    await page.locator("#registerButton").click();
    if (duplicate) {
      await expect(page.locator("#registerError")).toHaveText("Ya existe una cuenta con ese email.");
    } else {
      await expect(page.locator("#loginStatus")).toContainText("Cuenta creada correctamente.");
      await expect(page.locator("#email")).toHaveValue(user.email);
      expect(api.matching("POST", "/api/v1/auth/register")[0].postDataJSON()).toEqual({
        name: user.name, email: user.email, password: "test-password-123",
      });
    }
    expect(await page.evaluate(() => sessionStorage.getItem("access_token"))).toBeNull();
  });
}

test("restores a valid session without requesting a refresh", async ({ page, api }) => {
  await restoreSession(page);
  expect(api.matching("GET", "/api/v1/users/me")[0].headers().authorization).toBe(`Bearer ${tokens.access_token}`);
  expect(api.matching("POST", "/api/v1/auth/refresh")).toHaveLength(0);
});

test("renews an expired access token before opening the workspace", async ({ page, api }) => {
  api.expiredAccess = true;
  await restoreSession(page, "expired-access");
  expect(api.matching("POST", "/api/v1/auth/refresh")[0].postDataJSON()).toEqual({ refresh_token: tokens.refresh_token });
  expect(await page.evaluate(() => sessionStorage.getItem("access_token"))).toBe(tokens.access_token);
});

test("clears an expired session when token refresh is rejected", async ({ page, api }) => {
  api.expiredAccess = true;
  api.refreshStatus = 401;
  await page.addInitScript(() => {
    sessionStorage.setItem("access_token", "expired-access");
    sessionStorage.setItem("refresh_token", "expired-refresh");
  });
  await page.goto("/");
  await expect(page.locator("#landingLoginButton")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});

test("clears the local session even if logout cannot reach the API", async ({ page, api }) => {
  await restoreSession(page);
  api.abortLogout = true;
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page.locator("#landingLoginButton")).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
});
