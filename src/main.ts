import {
  ApiConfigurationError,
  ApiHttpError,
  ApiNetworkError,
  authApi,
  type User,
} from "./api/auth.js";
import { BrowserCameraScanner } from "./implementations/BrowserCameraScanner.js";
import { LocalStorageQRCodeStorage } from "./implementations/LocalStorageQRCodeStorage.js";
import { App } from "./App.js";
import { clearSession, getAccessToken, getRefreshToken, saveSession } from "./auth/session.js";

interface PageElements {
  loginForm: HTMLFormElement;
  loginPage: HTMLElement;
  appPage: HTMLElement;
  loginError: HTMLElement;
  loginButton: HTMLButtonElement;
  passwordInput: HTMLInputElement;
  logoutButton: HTMLButtonElement;
  currentUser: HTMLElement;
}

let appInstance: App | null = null;
let currentUser: User | null = null;

window.addEventListener("DOMContentLoaded", () => {
  const elements = getPageElements();
  elements.loginButton.disabled = true;

  elements.loginForm.addEventListener("submit", (event) => {
    void handleLogin(event, elements);
  });

  elements.logoutButton.addEventListener("click", () => {
    void handleLogout(elements);
  });

  void restoreSession(elements);
});

function getPageElements(): PageElements {
  return {
    loginForm: document.getElementById("loginForm") as HTMLFormElement,
    loginPage: document.getElementById("loginPage") as HTMLElement,
    appPage: document.getElementById("appPage") as HTMLElement,
    loginError: document.getElementById("loginError") as HTMLElement,
    loginButton: document.getElementById("loginButton") as HTMLButtonElement,
    passwordInput: document.getElementById("password") as HTMLInputElement,
    logoutButton: document.getElementById("logoutButton") as HTMLButtonElement,
    currentUser: document.getElementById("currentUser") as HTMLElement,
  };
}

async function handleLogin(event: SubmitEvent, elements: PageElements): Promise<void> {
  event.preventDefault();
  if (elements.loginButton.disabled) return;

  const formData = new FormData(elements.loginForm);
  const email = readFormValue(formData.get("email")).trim();
  const password = readFormValue(formData.get("password"));

  elements.loginButton.disabled = true;
  hideLoginError(elements);

  try {
    const tokens = await authApi.login(email, password);
    saveSession(tokens);

    const user = await authApi.getCurrentUser(tokens.access_token);
    elements.loginForm.reset();
    startApp(user, elements);
  } catch (error) {
    clearSession();
    elements.passwordInput.value = "";
    showLogin(elements, getLoginErrorMessage(error));
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function restoreSession(elements: PageElements): Promise<void> {
  const accessToken = getAccessToken();
  const refreshToken = getRefreshToken();

  if (!accessToken || !refreshToken) {
    clearSession();
    showLogin(elements);
    elements.loginButton.disabled = false;
    return;
  }

  try {
    const user = await authApi.getCurrentUser(accessToken);
    startApp(user, elements);
    return;
  } catch (error) {
    if (!isUnauthorized(error)) {
      showLogin(elements, getRestoreErrorMessage(error));
      elements.loginButton.disabled = false;
      return;
    }
  }

  try {
    const tokens = await authApi.refresh(refreshToken);
    saveSession(tokens);

    const user = await authApi.getCurrentUser(tokens.access_token);
    startApp(user, elements);
  } catch (error) {
    clearSession();
    showLogin(elements, getRestoreErrorMessage(error));
  } finally {
    elements.loginButton.disabled = false;
  }
}

async function handleLogout(elements: PageElements): Promise<void> {
  const accessToken = getAccessToken();
  elements.logoutButton.disabled = true;

  try {
    if (accessToken) {
      await authApi.logout(accessToken);
    }
  } catch {
    // Local session cleanup must not depend on the logout request succeeding.
  } finally {
    clearSession();
    appInstance?.stop();
    showLogin(elements);
    elements.loginForm.reset();
    elements.logoutButton.disabled = false;
    elements.loginButton.disabled = false;
  }
}

function startApp(user: User, elements: PageElements): void {
  if (appInstance === null) {
    const video = document.getElementById("video") as HTMLVideoElement;
    const overlay = document.getElementById("overlay") as HTMLCanvasElement;
    const scanner = new BrowserCameraScanner(video, overlay);
    const storage = new LocalStorageQRCodeStorage();

    appInstance = new App(scanner, storage);
  }

  currentUser = user;
  elements.currentUser.textContent = `${user.name} — ${user.role}`;
  elements.loginPage.hidden = true;
  elements.appPage.hidden = false;
}

function showLogin(elements: PageElements, message?: string): void {
  currentUser = null;
  elements.loginPage.hidden = false;
  elements.appPage.hidden = true;
  elements.currentUser.textContent = "";

  if (message) {
    elements.loginError.textContent = message;
    elements.loginError.hidden = false;
  } else {
    hideLoginError(elements);
  }
}

function hideLoginError(elements: PageElements): void {
  elements.loginError.hidden = true;
}

function readFormValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401;
}

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError && error.status === 401) {
    return "Email o contraseña incorrectos.";
  }

  if (error instanceof ApiNetworkError) {
    return "No se pudo conectar con el servidor. Intentá nuevamente en unos segundos.";
  }

  if (error instanceof ApiConfigurationError) {
    return "No se pudo iniciar sesión. Verificá la configuración del servidor.";
  }

  return "No se pudo iniciar sesión. Intentá nuevamente.";
}

function getRestoreErrorMessage(error: unknown): string {
  if (error instanceof ApiNetworkError) {
    return "No se pudo conectar con el servidor. Intentá nuevamente en unos segundos.";
  }

  if (error instanceof ApiConfigurationError) {
    return "No se pudo iniciar sesión. Verificá la configuración del servidor.";
  }

  if (isUnauthorized(error)) {
    return "Tu sesión expiró. Iniciá sesión nuevamente.";
  }

  return "No se pudo iniciar sesión. Intentá nuevamente.";
}
