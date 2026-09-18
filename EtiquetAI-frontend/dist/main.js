"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BrowserCameraScanner_js_1 = require("./implementations/BrowserCameraScanner.js");
const LocalStorageQRCodeStorage_js_1 = require("./implementations/LocalStorageQRCodeStorage.js");
const App_js_1 = require("./App.js");
window.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const loginPage = document.getElementById("loginPage");
    const appPage = document.getElementById("appPage");
    const loginError = document.getElementById("loginError");
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
    const video = document.getElementById("video");
    const overlay = document.getElementById("overlay");
    const scanner = new BrowserCameraScanner_js_1.BrowserCameraScanner(video, overlay);
    const storage = new LocalStorageQRCodeStorage_js_1.LocalStorageQRCodeStorage();
    // eslint-disable-next-line no-new
    new App_js_1.App(scanner, storage);
}
