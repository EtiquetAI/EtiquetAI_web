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
import { clearSession, getAccessToken, saveSession } from "./auth/session.js";
import { restoreUserSession } from "./auth/restore.js";

interface PageElements {
  authTitle: HTMLElement;
  authSubtitle: HTMLElement;
  loginForm: HTMLFormElement;
  registerForm: HTMLFormElement;
  loginPage: HTMLElement;
  appPage: HTMLElement;
  loginError: HTMLElement;
  loginStatus: HTMLElement;
  registerError: HTMLElement;
  loginButton: HTMLButtonElement;
  registerButton: HTMLButtonElement;
  showRegisterButton: HTMLButtonElement;
  showLoginButton: HTMLButtonElement;
  emailInput: HTMLInputElement;
  passwordInput: HTMLInputElement;
  registerPasswordInput: HTMLInputElement;
  registerPasswordConfirmationInput: HTMLInputElement;
  logoutButton: HTMLButtonElement;
  currentUser: HTMLElement;
}

let appInstance: App | null = null;
let currentUser: User | null = null;

window.addEventListener("DOMContentLoaded", () => {
  const elements = getPageElements();
  setAuthControlsDisabled(elements, true);

  elements.loginForm.addEventListener("submit", (event) => {
    void handleLogin(event, elements);
  });

  elements.registerForm.addEventListener("submit", (event) => {
    void handleRegister(event, elements);
  });

  elements.showRegisterButton.addEventListener("click", () => {
    showRegisterMode(elements);
  });

  elements.showLoginButton.addEventListener("click", () => {
    showLoginMode(elements);
  });

  elements.logoutButton.addEventListener("click", () => {
    void handleLogout(elements);
  });

  void restoreSession(elements);
});

function getPageElements(): PageElements {
  return {
    authTitle: document.getElementById("authTitle") as HTMLElement,
    authSubtitle: document.getElementById("authSubtitle") as HTMLElement,
    loginForm: document.getElementById("loginForm") as HTMLFormElement,
    registerForm: document.getElementById("registerForm") as HTMLFormElement,
    loginPage: document.getElementById("loginPage") as HTMLElement,
    appPage: document.getElementById("appPage") as HTMLElement,
    loginError: document.getElementById("loginError") as HTMLElement,
    loginStatus: document.getElementById("loginStatus") as HTMLElement,
    registerError: document.getElementById("registerError") as HTMLElement,
    loginButton: document.getElementById("loginButton") as HTMLButtonElement,
    registerButton: document.getElementById("registerButton") as HTMLButtonElement,
    showRegisterButton: document.getElementById("showRegisterButton") as HTMLButtonElement,
    showLoginButton: document.getElementById("showLoginButton") as HTMLButtonElement,
    emailInput: document.getElementById("email") as HTMLInputElement,
    passwordInput: document.getElementById("password") as HTMLInputElement,
    registerPasswordInput: document.getElementById("registerPassword") as HTMLInputElement,
    registerPasswordConfirmationInput: document.getElementById("registerPasswordConfirmation") as HTMLInputElement,
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

  setAuthControlsDisabled(elements, true);
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
    setAuthControlsDisabled(elements, false);
  }
}

async function handleRegister(event: SubmitEvent, elements: PageElements): Promise<void> {
  event.preventDefault();
  if (elements.registerButton.disabled) return;

  const formData = new FormData(elements.registerForm);
  const name = readFormValue(formData.get("name")).trim();
  const email = readFormValue(formData.get("email")).trim();
  const password = readFormValue(formData.get("password"));
  const passwordConfirmation = readFormValue(formData.get("password_confirmation"));

  setAuthControlsDisabled(elements, true);
  hideRegisterError(elements);

  try {
    if (password !== passwordConfirmation) {
      elements.registerPasswordInput.value = "";
      elements.registerPasswordConfirmationInput.value = "";
      showRegisterError(elements, "Las contraseñas no coinciden.");
      return;
    }

    await authApi.register(name, email, password);
    elements.registerForm.reset();
    elements.passwordInput.value = "";
    showLogin(elements);
    elements.emailInput.value = email;
    elements.loginStatus.textContent = "Cuenta creada. Ahora iniciá sesión.";
    elements.loginStatus.hidden = false;
  } catch (error) {
    elements.registerPasswordInput.value = "";
    elements.registerPasswordConfirmationInput.value = "";
    showRegisterError(elements, getRegisterErrorMessage(error));
  } finally {
    setAuthControlsDisabled(elements, false);
  }
}

async function restoreSession(elements: PageElements): Promise<void> {
  try {
    const user = await restoreUserSession();
    if (user) {
      startApp(user, elements);
    } else {
      showLogin(elements);
    }
  } catch (error) {
    showLogin(elements, getRestoreErrorMessage(error));
  } finally {
    setAuthControlsDisabled(elements, false);
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
    elements.registerForm.reset();
    elements.logoutButton.disabled = false;
    setAuthControlsDisabled(elements, false);
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
  showLoginMode(elements);

  if (message) {
    elements.loginError.textContent = message;
    elements.loginError.hidden = false;
  } else {
    hideLoginError(elements);
  }
}

function showLoginMode(elements: PageElements): void {
  elements.authTitle.textContent = "Iniciar sesión";
  elements.authSubtitle.textContent = "Control inteligente para tus paquetes.";
  elements.loginForm.hidden = false;
  elements.registerForm.hidden = true;
  hideLoginError(elements);
  elements.loginStatus.hidden = true;
  hideRegisterError(elements);
}

function showRegisterMode(elements: PageElements): void {
  elements.authTitle.textContent = "Crear cuenta";
  elements.authSubtitle.textContent = "Registrate para comenzar a usar EtiquetAI.";
  elements.loginForm.hidden = true;
  elements.registerForm.hidden = false;
  hideLoginError(elements);
  elements.loginStatus.hidden = true;
  hideRegisterError(elements);
  document.getElementById("registerName")?.focus();
}

function hideLoginError(elements: PageElements): void {
  elements.loginError.hidden = true;
}

function showRegisterError(elements: PageElements, message: string): void {
  elements.registerError.textContent = message;
  elements.registerError.hidden = false;
}

function hideRegisterError(elements: PageElements): void {
  elements.registerError.hidden = true;
}

function setAuthControlsDisabled(elements: PageElements, disabled: boolean): void {
  elements.loginButton.disabled = disabled;
  elements.registerButton.disabled = disabled;
  elements.showRegisterButton.disabled = disabled;
  elements.showLoginButton.disabled = disabled;
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

function getRegisterErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError && error.status === 409) {
    return "Ese email ya está registrado. Iniciá sesión o usá otro email.";
  }

  if (error instanceof ApiHttpError && error.status === 400) {
    return "Revisá los datos ingresados.";
  }

  if (error instanceof ApiNetworkError) {
    return "No se pudo conectar con el servidor. Intentá nuevamente en unos segundos.";
  }

  if (error instanceof ApiConfigurationError) {
    return "No se pudo crear la cuenta. Verificá la configuración del servidor.";
  }

  return "No se pudo crear la cuenta. Intentá nuevamente.";
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
