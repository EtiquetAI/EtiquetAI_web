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

const AUTH_VIEW_LANDING = "landing" as const;
const AUTH_VIEW_LOGIN = "login" as const;
const AUTH_VIEW_REGISTER = "register" as const;
const AUTH_VIEW_AUTHENTICATED = "authenticated" as const;

type AuthView = typeof AUTH_VIEW_LOGIN | typeof AUTH_VIEW_REGISTER;
type ApplicationView = AuthView | typeof AUTH_VIEW_LANDING | typeof AUTH_VIEW_AUTHENTICATED;

interface PageElements {
  sessionGate: HTMLElement;
  landingPage: HTMLElement;
  authPage: HTMLElement;
  appPage: HTMLElement;
  landingLoginButton: HTMLButtonElement;
  landingRegisterButton: HTMLButtonElement;
  heroRegisterButton: HTMLButtonElement;
  landingCtaButton: HTMLButtonElement;
  authBackButton: HTMLButtonElement;
  authTitle: HTMLElement;
  authSubtitle: HTMLElement;
  loginForm: HTMLFormElement;
  registerForm: HTMLFormElement;
  loginError: HTMLElement;
  loginStatus: HTMLElement;
  registerError: HTMLElement;
  loginButton: HTMLButtonElement;
  registerButton: HTMLButtonElement;
  showRegisterButton: HTMLButtonElement;
  showLoginButton: HTMLButtonElement;
  emailInput: HTMLInputElement;
  passwordInput: HTMLInputElement;
  registerNameInput: HTMLInputElement;
  registerEmailInput: HTMLInputElement;
  registerPhoneInput: HTMLInputElement;
  registerPasswordInput: HTMLInputElement;
  registerPasswordConfirmationInput: HTMLInputElement;
  registerPasswordStrength: HTMLElement;
  registerPasswordStrengthLabel: HTMLElement;
  registerPasswordStrengthHint: HTMLElement;
  authInputs: HTMLInputElement[];
  passwordToggleButtons: HTMLButtonElement[];
  logoutButton: HTMLButtonElement;
  currentUser: HTMLElement;
}

interface ValidationError {
  input: HTMLInputElement;
  message: string;
}

let appInstance: App | null = null;
let currentUser: User | null = null;
let currentView: ApplicationView = AUTH_VIEW_LANDING;

window.addEventListener("DOMContentLoaded", () => {
  const elements = getPageElements();
  bindPasswordVisibility(elements);
  bindPasswordStrength(elements);
  bindLandingNavigation(elements);
  setAuthView(elements, AUTH_VIEW_LOGIN);
  setAuthControlsDisabled(elements, true);
  elements.loginStatus.hidden = true;

  elements.loginForm.addEventListener("submit", (event) => {
    void handleLogin(event, elements);
  });

  elements.registerForm.addEventListener("submit", (event) => {
    void handleRegister(event, elements);
  });

  elements.showRegisterButton.addEventListener("click", () => {
    showRegister(elements);
  });

  elements.showLoginButton.addEventListener("click", () => {
    showLogin(elements);
  });

  elements.logoutButton.addEventListener("click", () => {
    void handleLogout(elements);
  });

  void restoreSession(elements);
});

function getPageElements(): PageElements {
  const emailInput = document.getElementById("email") as HTMLInputElement;
  const passwordInput = document.getElementById("password") as HTMLInputElement;
  const registerNameInput = document.getElementById("registerName") as HTMLInputElement;
  const registerEmailInput = document.getElementById("registerEmail") as HTMLInputElement;
  const registerPhoneInput = document.getElementById("registerPhone") as HTMLInputElement;
  const registerPasswordInput = document.getElementById("registerPassword") as HTMLInputElement;
  const registerPasswordConfirmationInput = document.getElementById("registerPasswordConfirmation") as HTMLInputElement;

  return {
    sessionGate: document.getElementById("sessionGate") as HTMLElement,
    landingPage: document.getElementById("landingPage") as HTMLElement,
    authPage: document.getElementById("authPage") as HTMLElement,
    appPage: document.getElementById("appPage") as HTMLElement,
    landingLoginButton: document.getElementById("landingLoginButton") as HTMLButtonElement,
    landingRegisterButton: document.getElementById("landingRegisterButton") as HTMLButtonElement,
    heroRegisterButton: document.getElementById("heroRegisterButton") as HTMLButtonElement,
    landingCtaButton: document.getElementById("landingCtaButton") as HTMLButtonElement,
    authBackButton: document.getElementById("authBackButton") as HTMLButtonElement,
    authTitle: document.getElementById("authTitle") as HTMLElement,
    authSubtitle: document.getElementById("authSubtitle") as HTMLElement,
    loginForm: document.getElementById("loginForm") as HTMLFormElement,
    registerForm: document.getElementById("registerForm") as HTMLFormElement,
    loginError: document.getElementById("loginError") as HTMLElement,
    loginStatus: document.getElementById("loginStatus") as HTMLElement,
    registerError: document.getElementById("registerError") as HTMLElement,
    loginButton: document.getElementById("loginButton") as HTMLButtonElement,
    registerButton: document.getElementById("registerButton") as HTMLButtonElement,
    showRegisterButton: document.getElementById("showRegisterButton") as HTMLButtonElement,
    showLoginButton: document.getElementById("showLoginButton") as HTMLButtonElement,
    emailInput,
    passwordInput,
    registerNameInput,
    registerEmailInput,
    registerPhoneInput,
    registerPasswordInput,
    registerPasswordConfirmationInput,
    registerPasswordStrength: document.getElementById("registerPasswordStrength") as HTMLElement,
    registerPasswordStrengthLabel: document.getElementById("registerPasswordStrengthLabel") as HTMLElement,
    registerPasswordStrengthHint: document.getElementById("registerPasswordStrengthHint") as HTMLElement,
    authInputs: [
      emailInput,
      passwordInput,
      registerNameInput,
      registerEmailInput,
      registerPhoneInput,
      registerPasswordInput,
      registerPasswordConfirmationInput,
    ],
    passwordToggleButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("[data-password-target]")),
    logoutButton: document.getElementById("logoutButton") as HTMLButtonElement,
    currentUser: document.getElementById("currentUser") as HTMLElement,
  };
}

function bindLandingNavigation(elements: PageElements): void {
  elements.landingLoginButton.addEventListener("click", () => {
    showLogin(elements);
  });

  for (const button of [elements.landingRegisterButton, elements.heroRegisterButton, elements.landingCtaButton]) {
    button.addEventListener("click", () => {
      showRegister(elements);
    });
  }

  elements.authBackButton.addEventListener("click", () => {
    showLanding(elements);
  });
}

async function handleLogin(event: SubmitEvent, elements: PageElements): Promise<void> {
  event.preventDefault();
  if (elements.loginButton.disabled) return;

  const formData = new FormData(elements.loginForm);
  const email = readFormValue(formData.get("email")).trim();
  const password = readFormValue(formData.get("password"));

  clearInputValidation(elements.authInputs);
  hideLoginError(elements);
  elements.loginStatus.hidden = true;

  const validationError = validateLogin(email, password, elements);
  if (validationError) {
    showLoginError(elements, validationError.message);
    validationError.input.setAttribute("aria-invalid", "true");
    validationError.input.focus();
    return;
  }

  setAuthControlsDisabled(elements, true);
  setButtonLoading(elements.loginButton, true);

  try {
    const tokens = await authApi.login(email, password);
    saveSession(tokens);

    const user = await authApi.getCurrentUser(tokens.access_token);
    elements.loginForm.reset();
    resetPasswordVisibility(elements);
    showAuthenticatedApp(user, elements);
  } catch (error) {
    clearSession();
    elements.passwordInput.value = "";
    resetPasswordVisibility(elements);
    showLoginError(elements, getLoginErrorMessage(error));
  } finally {
    setButtonLoading(elements.loginButton, false);
    setAuthControlsDisabled(elements, false);
  }
}

async function handleRegister(event: SubmitEvent, elements: PageElements): Promise<void> {
  event.preventDefault();
  if (elements.registerButton.disabled) return;

  const formData = new FormData(elements.registerForm);
  const name = readFormValue(formData.get("name")).trim();
  const email = readFormValue(formData.get("email")).trim();
  const phone = readFormValue(formData.get("phone_number")).trim();
  const password = readFormValue(formData.get("password"));
  const passwordConfirmation = readFormValue(formData.get("password_confirmation"));

  clearInputValidation(elements.authInputs);
  hideRegisterError(elements);

  const validationError = validateRegister(name, email, phone, password, passwordConfirmation, elements);
  if (validationError) {
    showRegisterError(elements, validationError.message);
    validationError.input.setAttribute("aria-invalid", "true");
    validationError.input.focus();
    return;
  }

  setAuthControlsDisabled(elements, true);
  setButtonLoading(elements.registerButton, true);

  try {
    await authApi.register({
      name,
      email,
      password,
      ...(phone ? { phone_number: phone } : {}),
    });

    elements.registerForm.reset();
    resetPasswordVisibility(elements);
    showLogin(elements);
    elements.emailInput.value = email;
    showLoginStatus(elements, "Cuenta creada correctamente. Ya podés iniciar sesión.");
    elements.emailInput.focus();
  } catch (error) {
    elements.registerPasswordInput.value = "";
    elements.registerPasswordConfirmationInput.value = "";
    resetPasswordVisibility(elements);
    showRegisterError(elements, getRegisterErrorMessage(error));
  } finally {
    setButtonLoading(elements.registerButton, false);
    setAuthControlsDisabled(elements, false);
  }
}

async function restoreSession(elements: PageElements): Promise<void> {
  try {
    const user = await restoreUserSession();
    if (user) {
      showAuthenticatedApp(user, elements);
    } else {
      showLanding(elements, false);
    }
  } catch {
    showLanding(elements, false);
  } finally {
    setAuthControlsDisabled(elements, false);
    elements.sessionGate.hidden = true;
    document.body.dataset.sessionState = "ready";
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
    showLanding(elements);
    elements.loginForm.reset();
    elements.registerForm.reset();
    resetPasswordVisibility(elements);
    elements.logoutButton.disabled = false;
    setAuthControlsDisabled(elements, false);
  }
}

function showAuthenticatedApp(user: User, elements: PageElements): void {
  if (appInstance === null) {
    const video = document.getElementById("video") as HTMLVideoElement;
    const overlay = document.getElementById("overlay") as HTMLCanvasElement;
    const scanner = new BrowserCameraScanner(video, overlay);
    const storage = new LocalStorageQRCodeStorage();

    appInstance = new App(scanner, storage);
  }

  currentUser = user;
  elements.currentUser.textContent = `${user.name} — ${user.role}`;
  setPageView(elements, AUTH_VIEW_AUTHENTICATED);
  window.requestAnimationFrame(() => {
    document.getElementById("startBtn")?.focus();
  });
}

function showLanding(elements: PageElements, focus = true): void {
  currentUser = null;
  elements.currentUser.textContent = "";
  setPageView(elements, AUTH_VIEW_LANDING);

  if (focus) {
    window.requestAnimationFrame(() => {
      elements.landingLoginButton.focus();
    });
  }
}

function showLogin(elements: PageElements, message?: string): void {
  currentUser = null;
  elements.currentUser.textContent = "";
  setPageView(elements, AUTH_VIEW_LOGIN);
  setAuthView(elements, AUTH_VIEW_LOGIN);

  if (message) {
    showLoginError(elements, message);
  }

  window.requestAnimationFrame(() => {
    elements.emailInput.focus();
  });
}

function showRegister(elements: PageElements): void {
  currentUser = null;
  elements.currentUser.textContent = "";
  setPageView(elements, AUTH_VIEW_REGISTER);
  setAuthView(elements, AUTH_VIEW_REGISTER);
  window.requestAnimationFrame(() => {
    elements.registerNameInput.focus();
  });
}

function setPageView(elements: PageElements, view: ApplicationView): void {
  const pages: Array<[HTMLElement, ApplicationView]> = [
    [elements.landingPage, AUTH_VIEW_LANDING],
    [elements.authPage, AUTH_VIEW_LOGIN],
    [elements.appPage, AUTH_VIEW_AUTHENTICATED],
  ];

  currentView = view;
  document.body.dataset.appView = view;

  for (const [page, pageView] of pages) {
    const isVisible = pageView === AUTH_VIEW_LANDING
      ? view === AUTH_VIEW_LANDING
      : pageView === AUTH_VIEW_LOGIN
        ? view === AUTH_VIEW_LOGIN || view === AUTH_VIEW_REGISTER
        : view === AUTH_VIEW_AUTHENTICATED;

    page.hidden = !isVisible;
    if (isVisible) {
      page.dataset.viewState = "entering";
      window.requestAnimationFrame(() => {
        page.dataset.viewState = "active";
      });
    }
  }

  document.title = view === AUTH_VIEW_LANDING
    ? "EtiquetAI | Lectura operativa"
    : view === AUTH_VIEW_AUTHENTICATED
      ? "EtiquetAI | Escáner QR"
      : "EtiquetAI | Acceso";
}

function setAuthView(elements: PageElements, view: AuthView): void {
  currentView = view;
  const isLogin = view === AUTH_VIEW_LOGIN;
  elements.authPage.dataset.authView = view;
  elements.loginForm.hidden = !isLogin;
  elements.registerForm.hidden = isLogin;
  elements.authTitle.textContent = isLogin ? "Ingresar al workspace" : "Crear una cuenta";
  elements.authSubtitle.textContent = isLogin
    ? "Continuá con el flujo de lectura de EtiquetAI."
    : "Guardá tu espacio de trabajo para empezar a escanear.";
  hideLoginError(elements);
  hideRegisterError(elements);
  elements.loginStatus.hidden = true;
  clearInputValidation(elements.authInputs);
  updatePasswordStrength(elements);
}

function bindPasswordVisibility(elements: PageElements): void {
  for (const button of elements.passwordToggleButtons) {
    button.addEventListener("click", () => {
      const targetId = button.dataset.passwordTarget;
      if (!targetId) return;

      const input = document.getElementById(targetId) as HTMLInputElement | null;
      if (!input) return;

      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.classList.toggle("is-visible", shouldShow);
      button.setAttribute("aria-pressed", String(shouldShow));
      button.setAttribute("aria-label", shouldShow ? "Ocultar contraseña" : "Mostrar contraseña");
    });
  }
}

function bindPasswordStrength(elements: PageElements): void {
  elements.registerPasswordInput.addEventListener("input", () => {
    updatePasswordStrength(elements);
  });
}

function updatePasswordStrength(elements: PageElements): void {
  const password = elements.registerPasswordInput.value;
  const strength = getPasswordStrength(password);
  const previousScore = Number(elements.registerPasswordStrength.dataset.strength ?? "0");

  elements.registerPasswordStrength.dataset.strength = String(strength.score);
  elements.registerPasswordStrength.style.setProperty("--strength-progress", String(strength.progress));
  elements.registerPasswordStrengthLabel.textContent = strength.label;
  elements.registerPasswordStrengthHint.textContent = strength.hint;

  if (previousScore !== strength.score) {
    elements.registerPasswordStrength.classList.remove("is-changing");
    window.requestAnimationFrame(() => {
      elements.registerPasswordStrength.classList.add("is-changing");
    });
  }
}

function getPasswordStrength(password: string): { score: number; progress: number; label: string; hint: string } {
  if (!password) {
    return { score: 0, progress: 0, label: "Seguridad", hint: "Usá 8 caracteres o más." };
  }

  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z\d]/.test(password);
  const variety = [hasLowercase, hasUppercase, hasNumber, hasSymbol].filter(Boolean).length;

  const lengthProgress = Math.min(password.length / 16, 1) * 0.45;
  const varietyProgress = (variety / 4) * 0.55;
  const progress = Math.min(1, Math.max(0.04, lengthProgress + varietyProgress));
  const score = progress >= 0.84 ? 4 : progress >= 0.62 ? 3 : progress >= 0.3 ? 2 : 1;
  const levels = ["", "Muy débil", "Débil", "Fuerte", "Muy fuerte"];
  const hints = ["", "Agregá más caracteres.", "Sumá mayúsculas, números o símbolos.", "Buena combinación de caracteres.", "Buena contraseña para usar."];

  return { score, progress, label: levels[score], hint: hints[score] };
}

function resetPasswordVisibility(elements: PageElements): void {
  for (const button of elements.passwordToggleButtons) {
    const targetId = button.dataset.passwordTarget;
    if (!targetId) continue;

    const input = document.getElementById(targetId) as HTMLInputElement | null;
    if (!input) continue;

    input.type = "password";
    button.classList.remove("is-visible");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", "Mostrar contraseña");
  }
}

function validateLogin(email: string, password: string, elements: PageElements): ValidationError | null {
  if (!email) {
    return { input: elements.emailInput, message: "Ingresá tu email." };
  }

  if (elements.emailInput.validity.typeMismatch) {
    return { input: elements.emailInput, message: "Ingresá un email válido." };
  }

  if (!password) {
    return { input: elements.passwordInput, message: "Ingresá tu contraseña." };
  }

  return null;
}

function validateRegister(
  name: string,
  email: string,
  phone: string,
  password: string,
  passwordConfirmation: string,
  elements: PageElements,
): ValidationError | null {
  if (!name) {
    return { input: elements.registerNameInput, message: "Ingresá tu nombre." };
  }

  if (name.length < 2 || name.length > 100) {
    return { input: elements.registerNameInput, message: "El nombre debe tener entre 2 y 100 caracteres." };
  }

  if (!email) {
    return { input: elements.registerEmailInput, message: "Ingresá tu email." };
  }

  if (elements.registerEmailInput.validity.typeMismatch) {
    return { input: elements.registerEmailInput, message: "Ingresá un email válido." };
  }

  if (phone && (!/^[0-9+()\s-]+$/.test(phone) || phone.length < 8 || phone.length > 20)) {
    return { input: elements.registerPhoneInput, message: "Ingresá un teléfono válido o dejá el campo vacío." };
  }

  if (password.length < 8) {
    return { input: elements.registerPasswordInput, message: "La contraseña debe tener al menos 8 caracteres." };
  }

  if (password !== passwordConfirmation) {
    return { input: elements.registerPasswordConfirmationInput, message: "Las contraseñas no coinciden." };
  }

  return null;
}

function showLoginError(elements: PageElements, message: string): void {
  elements.loginError.textContent = message;
  elements.loginError.hidden = false;
  elements.loginStatus.hidden = true;
}

function hideLoginError(elements: PageElements): void {
  elements.loginError.textContent = "";
  elements.loginError.hidden = true;
}

function showLoginStatus(elements: PageElements, message: string): void {
  elements.loginStatus.textContent = message;
  elements.loginStatus.hidden = false;
  hideLoginError(elements);
}

function showRegisterError(elements: PageElements, message: string): void {
  elements.registerError.textContent = message;
  elements.registerError.hidden = false;
}

function hideRegisterError(elements: PageElements): void {
  elements.registerError.textContent = "";
  elements.registerError.hidden = true;
}

function clearInputValidation(inputs: HTMLInputElement[]): void {
  for (const input of inputs) {
    input.removeAttribute("aria-invalid");
  }
}

function setAuthControlsDisabled(elements: PageElements, disabled: boolean): void {
  for (const input of elements.authInputs) {
    input.disabled = disabled;
  }

  for (const button of elements.passwordToggleButtons) {
    button.disabled = disabled;
  }

  elements.loginButton.disabled = disabled;
  elements.registerButton.disabled = disabled;
  elements.showRegisterButton.disabled = disabled;
  elements.showLoginButton.disabled = disabled;
}

function setButtonLoading(button: HTMLButtonElement, loading: boolean): void {
  const label = button.querySelector<HTMLElement>("[data-button-label]");
  const defaultLabel = button.dataset.defaultLabel ?? label?.textContent ?? "";
  const loadingLabel = button.dataset.loadingLabel ?? defaultLabel;

  if (label) {
    label.textContent = loading ? loadingLabel : defaultLabel;
  }

  button.classList.toggle("is-loading", loading);
  button.setAttribute("aria-busy", String(loading));
}

function readFormValue(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 401;
}

function getLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError && (error.status === 401 || error.code === "invalid_credentials")) {
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
  if (error instanceof ApiHttpError && (error.status === 409 || error.code === "email_already_registered")) {
    return "Ya existe una cuenta con ese email.";
  }

  if (error instanceof ApiHttpError && (error.status === 400 || error.code === "invalid_request")) {
    return "Revisá los datos ingresados.";
  }

  if (error instanceof ApiNetworkError) {
    return "No se pudo conectar con el servidor. Intentá nuevamente en unos segundos.";
  }

  if (error instanceof ApiConfigurationError) {
    return "No pudimos crear la cuenta. Verificá la configuración del servidor.";
  }

  if (error instanceof ApiHttpError && error.status >= 500) {
    return "No pudimos crear la cuenta. Intentá nuevamente.";
  }

  return "No pudimos crear la cuenta. Intentá nuevamente.";
}
