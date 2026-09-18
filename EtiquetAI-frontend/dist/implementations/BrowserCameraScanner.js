"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserCameraScanner = void 0;
const Scanner_js_1 = require("../abstracts/Scanner.js");
class BrowserCameraScanner extends Scanner_js_1.Scanner {
    constructor(videoEl, canvasEl) {
        super();
        this.ctx = null;
        this.stream = null;
        this.running = false;
        this.video = videoEl;
        this.canvas = canvasEl;
        this.ctx = this.canvas.getContext("2d");
    }
    async start() {
        if (this.running)
            return;
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.running = true;
        this.tick();
    }
    stop() {
        this.running = false;
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.video.pause();
        this.video.srcObject = null;
    }
    tick() {
        if (!this.running)
            return;
        if (!this.ctx)
            return;
        const w = this.video.videoWidth;
        const h = this.video.videoHeight;
        if (w && h) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.ctx.drawImage(this.video, 0, 0, w, h);
            const imageData = this.ctx.getImageData(0, 0, w, h);
            try {
                // jsQR is provided by CDN and declared in globals.d.ts
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                if (code && code.data && this.onDetected) {
                    this.onDetected(code.data);
                }
            }
            catch (e) {
                // ignore
            }
        }
        requestAnimationFrame(() => this.tick());
    }
}
exports.BrowserCameraScanner = BrowserCameraScanner;
