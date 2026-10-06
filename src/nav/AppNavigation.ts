export type AppView = "scan" | "upload" | "results";

const TITLES: Record<AppView, string> = {
  scan: "Escanear QR",
  upload: "Ingresar imagen",
  results: "Resultados",
};

export class AppNavigation {
  private readonly tabs: HTMLButtonElement[];
  private readonly panels: HTMLElement[];
  private readonly title: HTMLElement;
  private readonly onShow: (view: AppView) => void;
  private current: AppView = "scan";

  constructor(onShow: (view: AppView) => void) {
    this.onShow = onShow;
    this.title = this.require("appTitle");
    const nav = document.querySelector<HTMLElement>(".app-nav");
    if (!nav) {
      throw new Error("Missing navigation element .app-nav");
    }
    this.tabs = Array.from(nav.querySelectorAll<HTMLButtonElement>("[data-app-tab]"));
    this.panels = Array.from(document.querySelectorAll<HTMLElement>("[data-app-panel]"));

    if (this.tabs.length !== this.panels.length) {
      throw new Error("Each navigation tab must have a matching panel.");
    }

    for (const tab of this.tabs) {
      tab.addEventListener("click", () => {
        const view = tab.dataset.appTab;
        if (isAppView(view)) {
          this.show(view);
        }
      });
    }

    this.show("scan");
  }

  show(view: AppView): void {
    if (this.current !== view) {
      this.onShow(view);
    }
    this.current = view;

    for (const tab of this.tabs) {
      const active = tab.dataset.appTab === view;
      tab.classList.toggle("is-active", active);
      if (active) {
        tab.setAttribute("aria-current", "page");
      } else {
        tab.removeAttribute("aria-current");
      }
    }

    for (const panel of this.panels) {
      panel.hidden = panel.dataset.appPanel !== view;
    }

    this.title.textContent = TITLES[view];
  }

  private require(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing element #${id}`);
    }
    return element;
  }
}

function isAppView(value: string | undefined): value is AppView {
  return value === "scan" || value === "upload" || value === "results";
}
