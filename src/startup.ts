import "./styles.css";
import {
  ArrowUpRight,
  FolderKanban,
  HardDrive,
  Image as ImageIcon,
  Images,
  LockKeyhole,
  Pencil,
  Plus,
  SquarePlus,
  Trash2,
  createElement as createLucideElement,
  type IconNode,
} from "lucide";
import {
  createProjectStorage,
  normalizeProjectTitle,
  type ProjectStorage,
  type ProjectSummaryV1,
} from "./project-storage";
import {
  completeStartupDiagnostics,
  markStartupPhase,
  reportStartupFailure,
} from "./startup-diagnostics";

const HOME_ICONS: Readonly<Record<string, IconNode>> = {
  "arrow-up-right": ArrowUpRight,
  "folder-kanban": FolderKanban,
  "hard-drive": HardDrive,
  image: ImageIcon,
  images: Images,
  "lock-keyhole": LockKeyhole,
  pencil: Pencil,
  plus: Plus,
  "square-plus": SquarePlus,
  "trash-2": Trash2,
};

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}.`);
  return result as T;
}

function icon(name: keyof typeof HOME_ICONS, label?: string): SVGElement {
  return createLucideElement(HOME_ICONS[name], {
    width: 18,
    height: 18,
    ...(label ? { "aria-label": label, role: "img" } : { "aria-hidden": "true" }),
  });
}

function hydrateHomeIcons(root: ParentNode): void {
  for (const placeholder of root.querySelectorAll<HTMLElement>("[data-lucide]")) {
    const name = placeholder.dataset.lucide;
    const node = name ? HOME_ICONS[name] : undefined;
    if (!node) continue;
    const replacement = createLucideElement(node, {
      width: 18,
      height: 18,
      "aria-hidden": "true",
    });
    if (placeholder.className) replacement.setAttribute("class", placeholder.className);
    placeholder.replaceWith(replacement);
  }
}

function shouldOpenEditor(search: URLSearchParams): boolean {
  if (search.get("home") === "1") return false;
  // Existing diagnostics and GPU fixtures are query-driven. Treat every query
  // except the explicit home route as an editor deep link for compatibility.
  return search.size > 0;
}

function projectEditorUrl(summary: ProjectSummaryV1): URL {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("project", summary.id);
  url.searchParams.set("documentSize", String(summary.documentWidth));
  return url;
}

function freshProjectId(): string {
  return `project-${crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatProjectDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

async function launchEditor(): Promise<void> {
  const home = element<HTMLElement>("projectHome");
  const app = element<HTMLElement>("app");
  home.hidden = true;
  home.inert = true;
  app.hidden = false;
  app.inert = false;
  markStartupPhase("Opening editor", "Loading the WebGPU drawing workspace.");
  await import("./main");
}

class ProjectHomeController {
  private readonly home = element<HTMLElement>("projectHome");
  private readonly tabs = [
    element<HTMLButtonElement>("projectsTab"),
    element<HTMLButtonElement>("newCanvasTab"),
  ] as const;
  private readonly panels = [
    element<HTMLElement>("projectsPanel"),
    element<HTMLElement>("newCanvasPanel"),
  ] as const;
  private readonly grid = element<HTMLElement>("projectGrid");
  private readonly empty = element<HTMLElement>("projectEmptyState");
  private readonly status = element<HTMLParagraphElement>("projectHomeStatus");
  private readonly storageSummary = element<HTMLElement>("projectStorageSummary");
  private readonly nameInput = element<HTMLInputElement>("newCanvasName");
  private readonly widthSelect = element<HTMLSelectElement>("newCanvasWidth");
  private readonly heightSelect = element<HTMLSelectElement>("newCanvasHeight");
  private readonly presetButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-canvas-size]"),
  );
  private readonly objectUrls = new Set<string>();
  private statusTimer: number | null = null;

  constructor(private readonly storage: ProjectStorage) {}

  async initialize(): Promise<void> {
    this.bindTabs();
    this.bindCanvasForm();
    element<HTMLButtonElement>("projectsCreateButton").addEventListener("click", () => {
      this.selectTab(1, true);
    });
    element<HTMLButtonElement>("emptyCreateButton").addEventListener("click", () => {
      this.selectTab(1, true);
    });

    this.setBusy(true);
    try {
      await this.storage.initialize();
      await this.refreshProjects();
      await this.refreshStorageSummary();
      void this.storage.requestPersistence().catch(() => false);
    } catch (error) {
      console.error("Project library startup failed:", error);
      this.showStatus("The local project library is unavailable in this browser.", true);
      this.storageSummary.textContent = "Storage unavailable";
      this.empty.hidden = false;
    } finally {
      this.setBusy(false);
    }
  }

  private bindTabs(): void {
    this.tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => this.selectTab(index, false));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = (index + direction + this.tabs.length) % this.tabs.length;
        this.selectTab(next, false);
        this.tabs[next].focus();
      });
    });
  }

  private selectTab(index: number, focusForm: boolean): void {
    this.tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      this.panels[tabIndex].hidden = !selected;
    });
    if (focusForm) requestAnimationFrame(() => this.nameInput.focus());
  }

  private bindCanvasForm(): void {
    const syncSize = (size: string) => {
      this.widthSelect.value = size;
      this.heightSelect.value = size;
      this.presetButtons.forEach((button) => {
        const selected = button.dataset.canvasSize === size;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    };
    this.presetButtons.forEach((button) => {
      button.addEventListener("click", () => syncSize(button.dataset.canvasSize ?? "4096"));
    });
    this.widthSelect.addEventListener("change", () => syncSize(this.widthSelect.value));
    this.heightSelect.addEventListener("change", () => syncSize(this.heightSelect.value));
    element<HTMLFormElement>("newCanvasForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const size = Number(this.widthSelect.value);
      if (size !== 2048 && size !== 4096) {
        this.showStatus("Choose a supported canvas size.", true);
        return;
      }
      const url = new URL(window.location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("project", freshProjectId());
      url.searchParams.set("newProject", "1");
      url.searchParams.set("projectName", normalizeProjectTitle(this.nameInput.value));
      url.searchParams.set("documentSize", String(size));
      this.setBusy(true);
      window.location.assign(url);
    });
  }

  private releaseObjectUrls(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
  }

  private async refreshProjects(): Promise<void> {
    const projects = (await this.storage.listProjects())
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt);
    this.releaseObjectUrls();
    this.grid.replaceChildren();
    this.empty.hidden = projects.length > 0;
    this.grid.hidden = projects.length === 0;
    for (const project of projects) this.grid.append(this.createProjectCard(project));
  }

  private createProjectCard(project: ProjectSummaryV1): HTMLElement {
    const card = document.createElement("article");
    card.className = "project-card";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "project-card-open";
    open.setAttribute("aria-label", `Open ${project.name}`);
    open.addEventListener("click", () => {
      this.setBusy(true);
      window.location.assign(projectEditorUrl(project));
    });

    const thumbnail = document.createElement("span");
    thumbnail.className = "project-card-thumbnail";
    if (project.thumbnail) {
      const url = URL.createObjectURL(project.thumbnail);
      this.objectUrls.add(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      thumbnail.append(image);
    } else {
      thumbnail.append(icon("image"));
    }
    const resolution = document.createElement("span");
    resolution.className = "project-card-resolution";
    resolution.textContent = `${project.documentWidth}²`;
    thumbnail.append(resolution);

    const copy = document.createElement("span");
    copy.className = "project-card-copy";
    const title = document.createElement("strong");
    title.textContent = project.name;
    const meta = document.createElement("small");
    meta.textContent = `${formatProjectDate(project.updatedAt)} · ${formatBytes(project.storedBytes)}`;
    copy.append(title, meta);
    open.append(thumbnail, copy);

    const actions = document.createElement("span");
    actions.className = "project-card-actions";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "project-card-action";
    rename.setAttribute("aria-label", `Rename ${project.name}`);
    rename.append(icon("pencil"));
    rename.addEventListener("click", async () => {
      const requested = window.prompt("Project name", project.name);
      if (requested === null) return;
      this.setBusy(true);
      try {
        await this.storage.renameProject(project.id, requested);
        await this.refreshProjects();
        this.showStatus("Project renamed.");
      } catch (error) {
        console.error("Project rename failed:", error);
        this.showStatus("The project could not be renamed.", true);
      } finally {
        this.setBusy(false);
      }
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "project-card-action is-danger";
    remove.setAttribute("aria-label", `Delete ${project.name}`);
    remove.append(icon("trash-2"));
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete “${project.name}” from this device?`)) return;
      this.setBusy(true);
      try {
        await this.storage.deleteProject(project.id);
        await this.refreshProjects();
        await this.refreshStorageSummary();
        this.showStatus("Project deleted.");
      } catch (error) {
        console.error("Project delete failed:", error);
        this.showStatus("The project could not be deleted.", true);
      } finally {
        this.setBusy(false);
      }
    });
    actions.append(rename, remove);
    card.append(open, actions);
    return card;
  }

  private async refreshStorageSummary(): Promise<void> {
    const estimate = await this.storage.estimateQuota();
    if (estimate.usageBytes !== null && estimate.quotaBytes !== null) {
      this.storageSummary.textContent = `${formatBytes(estimate.usageBytes)} of `
        + `${formatBytes(estimate.quotaBytes)} used`;
      return;
    }
    this.storageSummary.textContent = this.storage.backend === "indexeddb"
      ? "Saved on this device"
      : "Session storage";
  }

  private setBusy(busy: boolean): void {
    this.home.classList.toggle("is-busy", busy);
    this.home.setAttribute("aria-busy", String(busy));
  }

  private showStatus(message: string, error = false): void {
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.status.hidden = false;
    this.status.textContent = message;
    this.status.classList.toggle("is-error", error);
    this.statusTimer = window.setTimeout(() => {
      this.status.hidden = true;
      this.statusTimer = null;
    }, 4_000);
  }
}

async function boot(): Promise<void> {
  const home = element<HTMLElement>("projectHome");
  hydrateHomeIcons(home);
  const search = new URLSearchParams(window.location.search);
  if (shouldOpenEditor(search)) {
    await launchEditor();
    return;
  }

  document.title = "M1M4.COM — Projects";
  const app = element<HTMLElement>("app");
  app.hidden = true;
  app.inert = true;
  home.hidden = false;
  home.inert = false;
  markStartupPhase("Project library ready", "Choose an artwork or create a canvas.");
  completeStartupDiagnostics();
  const controller = new ProjectHomeController(createProjectStorage());
  await controller.initialize();
}

void boot().catch((error) => {
  reportStartupFailure(error);
  console.error("M1M4 startup failed:", error);
});
