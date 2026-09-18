import { BrowserCameraScanner } from "./implementations/BrowserCameraScanner.js";
import { LocalStorageQRCodeStorage } from "./implementations/LocalStorageQRCodeStorage.js";
import { App } from "./App.js";

window.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("loginForm") as HTMLFormElement;
  const loginPage = document.getElementById("loginPage") as HTMLElement;
  const appPage = document.getElementById("appPage") as HTMLElement;
  const loginError = document.getElementById("loginError") as HTMLElement;

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const username = formData.get("username");
    const password = formData.get("password");

    if (username !== "fiuba" || password !== "1234") {
      loginError.hidden = false;
      return;
    }

    loginError.hidden = true;
    loginPage.hidden = true;
    appPage.hidden = false;
    startApp();
  });
});

function startApp() {
  const video = document.getElementById("video") as HTMLVideoElement;
  const overlay = document.getElementById("overlay") as HTMLCanvasElement;

  const scanner = new BrowserCameraScanner(video, overlay);
  const storage = new LocalStorageQRCodeStorage();

  // eslint-disable-next-line no-new
  new App(scanner, storage);
}
