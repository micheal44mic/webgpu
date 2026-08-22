import "./styles.css";
import {
  ArrowUpRight,
  FolderKanban,
  HardDrive,
  Image as ImageIcon,
  Images,
  Link2,
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
  type ProjectLoadResultV1,
  type ProjectStorage,
  type ProjectSummaryV1,
} from "./project-storage";
import type { ProjectEditorBootstrap } from "./project-shell-contract";
import {
  markStartupTiming,
  markStartupTimingOnce,
  measureStartupTiming,
  publishStartupTiming,
} from "./startup-timing";

markStartupTimingOnce("startup-entry-evaluated");

const HOME_ICONS: Readonly<Record<string, IconNode>> = {
  "arrow-up-right": ArrowUpRight,
  "folder-kanban": FolderKanban,
  "hard-drive": HardDrive,
  image: ImageIcon,
  images: Images,
  "link-2": Link2,
  pencil: Pencil,
  plus: Plus,
  "square-plus": SquarePlus,
  "trash-2": Trash2,
};

function element<T extends HTMLElement>(root: ParentNode, id: string): T {
  const rootElement = root as ParentNode & Partial<HTMLElement>;
  const result = rootElement.id === id
    ? rootElement as HTMLElement
    : root.querySelector<HTMLElement>(`#${id}`);
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
  // `URLSearchParams.size` is missing on older iPhone Safari releases that
  // otherwise support this app, while serialization is universally available.
  return search.toString().length > 0;
}

function projectEditorUrl(summary: ProjectSummaryV1, currentHref: string): URL {
  const url = new URL(currentHref);
  const startupDebug = url.searchParams.get("startupDebug");
  url.search = "";
  url.hash = "";
  url.searchParams.set("project", summary.id);
  url.searchParams.set("documentWidth", String(summary.documentWidth));
  url.searchParams.set("documentHeight", String(summary.documentHeight));
  if (summary.documentWidth === summary.documentHeight) {
    url.searchParams.set("documentSize", String(summary.documentWidth));
  }
  if (startupDebug === "1") url.searchParams.set("startupDebug", "1");
  return url;
}

const MIN_CANVAS_DIMENSION = 64;
const MAX_CANVAS_DIMENSION = 4000;
const LEGACY_CANVAS_DIMENSION = 4096;

function parsedEditorDimension(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value)
    && value >= MIN_CANVAS_DIMENSION
    && value <= MAX_CANVAS_DIMENSION
    ? value
    : null;
}

function editorDimensionsAreValid(search: URLSearchParams): boolean {
  const widthRaw = search.get("documentWidth");
  const heightRaw = search.get("documentHeight");
  if (widthRaw !== null || heightRaw !== null) {
    if (
      search.get("newProject") !== "1"
      &&
      Number(widthRaw) === LEGACY_CANVAS_DIMENSION
      && Number(heightRaw) === LEGACY_CANVAS_DIMENSION
    ) {
      return true;
    }
    return parsedEditorDimension(widthRaw) !== null
      && parsedEditorDimension(heightRaw) !== null;
  }
  const legacyRaw = search.get("documentSize");
  if (legacyRaw === null) return true;
  return parsedEditorDimension(legacyRaw) !== null
    || (
      search.get("newProject") !== "1"
      && Number(legacyRaw) === LEGACY_CANVAS_DIMENSION
    );
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

function showApplicationSurface(surface: "home" | "editor"): void {
  const home = element<HTMLElement>(document, "projectHome");
  const app = element<HTMLElement>(document, "app");
  const editor = surface === "editor";
  home.hidden = editor;
  home.inert = editor;
  app.hidden = !editor;
  app.inert = !editor;
}

type OpenEditor = (
  url: URL,
  preloadedProjectId: string | null,
  preloadedProject: Promise<ProjectLoadResultV1 | null> | null,
) => Promise<void>;

interface ProjectHomeControllerOptions {
  readonly storage: ProjectStorage;
  readonly root: ParentNode;
  readonly browser: Window;
  readonly document: Document;
  readonly objectUrl: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  readonly openEditor: OpenEditor;
}

class ProjectHomeController {
  private readonly storage: ProjectStorage;
  private readonly root: ParentNode;
  private readonly browser: Window;
  private readonly document: Document;
  private readonly objectUrl: ProjectHomeControllerOptions["objectUrl"];
  private readonly openEditor: OpenEditor;
  private readonly home: HTMLElement;
  private readonly tabs: readonly [HTMLButtonElement, HTMLButtonElement];
  private readonly panels: readonly [HTMLElement, HTMLElement];
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly status: HTMLParagraphElement;
  private readonly storageSummary: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly widthInput: HTMLInputElement;
  private readonly heightInput: HTMLInputElement;
  private readonly dimensionLink: HTMLButtonElement;
  private readonly presetButtons: HTMLButtonElement[];
  private readonly objectUrls = new Set<string>();
  private statusTimer: number | null = null;

  constructor(options: ProjectHomeControllerOptions) {
    this.storage = options.storage;
    this.root = options.root;
    this.browser = options.browser;
    this.document = options.document;
    this.objectUrl = options.objectUrl;
    this.openEditor = options.openEditor;
    this.home = element<HTMLElement>(options.root, "projectHome");
    this.tabs = [
      element<HTMLButtonElement>(options.root, "projectsTab"),
      element<HTMLButtonElement>(options.root, "newCanvasTab"),
    ];
    this.panels = [
      element<HTMLElement>(options.root, "projectsPanel"),
      element<HTMLElement>(options.root, "newCanvasPanel"),
    ];
    this.grid = element<HTMLElement>(options.root, "projectGrid");
    this.empty = element<HTMLElement>(options.root, "projectEmptyState");
    this.status = element<HTMLParagraphElement>(options.root, "projectHomeStatus");
    this.storageSummary = element<HTMLElement>(options.root, "projectStorageSummary");
    this.nameInput = element<HTMLInputElement>(options.root, "newCanvasName");
    this.widthInput = element<HTMLInputElement>(options.root, "newCanvasWidth");
    this.heightInput = element<HTMLInputElement>(options.root, "newCanvasHeight");
    this.dimensionLink = element<HTMLButtonElement>(options.root, "canvasDimensionLink");
    this.presetButtons = Array.from(
      options.root.querySelectorAll<HTMLButtonElement>("[data-canvas-width][data-canvas-height]"),
    );
  }

  async initialize(): Promise<void> {
    this.bindTabs();
    this.bindCanvasForm();
    element<HTMLButtonElement>(this.root, "projectsCreateButton").addEventListener("click", () => {
      this.selectTab(1, true);
    });
    element<HTMLButtonElement>(this.root, "emptyCreateButton").addEventListener("click", () => {
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
    if (focusForm) this.browser.requestAnimationFrame(() => this.nameInput.focus());
  }

  private bindCanvasForm(): void {
    let dimensionsLinked = true;
    const updateLinkedState = (linked: boolean) => {
      dimensionsLinked = linked;
      this.dimensionLink.classList.toggle("is-linked", linked);
      this.dimensionLink.setAttribute("aria-pressed", String(linked));
      this.dimensionLink.setAttribute(
        "aria-label",
        linked ? "Width and height are linked; allow independent dimensions"
          : "Width and height are independent; make them equal",
      );
      this.dimensionLink.title = linked
        ? "Width and height are linked"
        : "Make width and height equal";
    };
    const updatePresetSelection = () => {
      const width = this.widthInput.value;
      const height = this.heightInput.value;
      this.presetButtons.forEach((button) => {
        const selected = button.dataset.canvasWidth === width
          && button.dataset.canvasHeight === height;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    };
    this.presetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const width = button.dataset.canvasWidth ?? "2048";
        const height = button.dataset.canvasHeight ?? "2048";
        this.widthInput.value = width;
        this.heightInput.value = height;
        updateLinkedState(width === height);
        updatePresetSelection();
      });
    });
    const handleDimensionInput = (source: HTMLInputElement, target: HTMLInputElement) => {
      if (dimensionsLinked) target.value = source.value;
      updatePresetSelection();
    };
    this.widthInput.addEventListener("input", () => {
      handleDimensionInput(this.widthInput, this.heightInput);
    });
    this.heightInput.addEventListener("input", () => {
      handleDimensionInput(this.heightInput, this.widthInput);
    });
    this.dimensionLink.addEventListener("click", () => {
      const nextLinked = !dimensionsLinked;
      if (nextLinked) this.heightInput.value = this.widthInput.value;
      updateLinkedState(nextLinked);
      updatePresetSelection();
    });
    const form = element<HTMLFormElement>(this.root, "newCanvasForm");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const width = Number(this.widthInput.value);
      const height = Number(this.heightInput.value);
      const dimensionsValid = Number.isInteger(width)
        && Number.isInteger(height)
        && width >= MIN_CANVAS_DIMENSION
        && height >= MIN_CANVAS_DIMENSION
        && width <= MAX_CANVAS_DIMENSION
        && height <= MAX_CANVAS_DIMENSION;
      if (!dimensionsValid) {
        this.showStatus("Enter whole-pixel dimensions from 64 to 4000 px.", true);
        return;
      }
      const url = new URL(this.browser.location.href);
      const startupDebug = url.searchParams.get("startupDebug");
      url.search = "";
      url.hash = "";
      const projectId = freshProjectId();
      url.searchParams.set("project", projectId);
      url.searchParams.set("newProject", "1");
      url.searchParams.set("projectName", normalizeProjectTitle(this.nameInput.value));
      url.searchParams.set("documentWidth", String(width));
      url.searchParams.set("documentHeight", String(height));
      if (width === height) url.searchParams.set("documentSize", String(width));
      if (startupDebug === "1") url.searchParams.set("startupDebug", "1");
      markStartupTiming("editor-open-request", {
        source: "new-project",
        documentWidth: width,
        documentHeight: height,
      });
      this.setBusy(true);
      void this.openEditor(url, projectId, null).catch((error) => {
        console.error("New project startup failed:", error);
        this.showStatus("The editor could not be opened.", true);
        this.setBusy(false);
      });
    });
  }

  private releaseObjectUrls(): void {
    for (const url of this.objectUrls) this.objectUrl.revokeObjectURL(url);
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
    const card = this.document.createElement("article");
    card.className = "project-card";
    const open = this.document.createElement("button");
    open.type = "button";
    open.className = "project-card-open";
    open.setAttribute("aria-label", `Open ${project.name}`);
    open.addEventListener("click", () => {
      this.setBusy(true);
      markStartupTiming("editor-open-request", {
        source: "saved-project",
        documentWidth: project.documentWidth,
        documentHeight: project.documentHeight,
        storedBytes: project.storedBytes,
      });
      const preloaded = measureStartupTiming(
        "project-storage-load",
        () => this.storage.loadProject(project.id),
        { storedBytes: project.storedBytes },
      );
      // Mark the eager read as handled while WebGPU starts; the editor still
      // awaits the original promise and surfaces the actual failure.
      void preloaded.catch(() => null);
      void this.openEditor(
        projectEditorUrl(project, this.browser.location.href),
        project.id,
        preloaded,
      ).catch((error) => {
        console.error("Project startup failed:", error);
        this.showStatus("The project could not be opened.", true);
        this.setBusy(false);
      });
    });

    const thumbnail = this.document.createElement("span");
    thumbnail.className = "project-card-thumbnail";
    thumbnail.style.aspectRatio = `${project.documentWidth} / ${project.documentHeight}`;
    if (project.thumbnail) {
      const url = this.objectUrl.createObjectURL(project.thumbnail);
      this.objectUrls.add(url);
      const image = this.document.createElement("img");
      image.src = url;
      image.alt = "";
      thumbnail.append(image);
    } else {
      thumbnail.append(icon("image"));
    }
    const resolution = this.document.createElement("span");
    resolution.className = "project-card-resolution";
    resolution.textContent = `${project.documentWidth} × ${project.documentHeight}`;
    thumbnail.append(resolution);

    const copy = this.document.createElement("span");
    copy.className = "project-card-copy";
    const title = this.document.createElement("strong");
    title.textContent = project.name;
    const meta = this.document.createElement("small");
    meta.textContent = `${formatProjectDate(project.updatedAt)} · ${formatBytes(project.storedBytes)}`;
    copy.append(title, meta);
    open.append(thumbnail, copy);

    const actions = this.document.createElement("span");
    actions.className = "project-card-actions";
    const rename = this.document.createElement("button");
    rename.type = "button";
    rename.className = "project-card-action";
    rename.setAttribute("aria-label", `Rename ${project.name}`);
    rename.append(icon("pencil"));
    rename.addEventListener("click", async () => {
      const requested = this.browser.prompt("Project name", project.name);
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
    const remove = this.document.createElement("button");
    remove.type = "button";
    remove.className = "project-card-action is-danger";
    remove.setAttribute("aria-label", `Delete ${project.name}`);
    remove.append(icon("trash-2"));
    remove.addEventListener("click", async () => {
      if (!this.browser.confirm(`Delete “${project.name}” from this device?`)) return;
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

  async refresh(): Promise<void> {
    this.setBusy(true);
    try {
      await this.refreshProjects();
      await this.refreshStorageSummary();
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean): void {
    this.home.classList.toggle("is-busy", busy);
    this.home.setAttribute("aria-busy", String(busy));
  }

  showStatus(message: string, error = false): void {
    if (this.statusTimer !== null) this.browser.clearTimeout(this.statusTimer);
    this.status.hidden = false;
    this.status.textContent = message;
    this.status.classList.toggle("is-error", error);
    this.statusTimer = this.browser.setTimeout(() => {
      this.status.hidden = true;
      this.statusTimer = null;
    }, 4_000);
  }
}

async function boot(): Promise<void> {
  markStartupTiming("shell-boot-start");
  const home = element<HTMLElement>(document, "projectHome");
  hydrateHomeIcons(home);
  const storage = createProjectStorage();
  const storageReady = measureStartupTiming(
    "project-storage-initialize",
    () => storage.initialize(),
  );
  void storageReady.catch(() => undefined);
  let homeController: ProjectHomeController | null = null;
  let editorLoaded = false;
  let suspendedEditorUrl: URL | null = null;
  let suspendedEditorTitle = "M1M4.COM — Editor";

  const ensureHomeController = async (): Promise<ProjectHomeController> => {
    if (homeController) return homeController;
    const controller = new ProjectHomeController({
      storage,
      root: home,
      browser: window,
      document,
      objectUrl: URL,
      openEditor,
    });
    homeController = controller;
    await controller.initialize();
    return controller;
  };

  const showHome = async (pushHistory = true): Promise<void> => {
    if (editorLoaded && shouldOpenEditor(new URLSearchParams(window.location.search))) {
      suspendedEditorUrl = new URL(window.location.href);
      suspendedEditorTitle = document.title;
    }
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    if (pushHistory) window.history.pushState(null, "", url);
    showApplicationSurface("home");
    document.title = "M1M4.COM — Projects";
    const alreadyInitialized = homeController !== null;
    const controller = await ensureHomeController();
    if (alreadyInitialized) await controller.refresh();
  };

  const sameSuspendedProject = (url: URL): boolean => (
    suspendedEditorUrl !== null
    && suspendedEditorUrl.searchParams.get("project") === url.searchParams.get("project")
    && suspendedEditorUrl.searchParams.get("documentWidth")
      === url.searchParams.get("documentWidth")
    && suspendedEditorUrl.searchParams.get("documentHeight")
      === url.searchParams.get("documentHeight")
  );

  const openEditor: OpenEditor = async (url, preloadedProjectId, preloadedProject) => {
    if (editorLoaded) {
      if (sameSuspendedProject(url)) {
        if (window.location.href !== url.href) {
          window.history.pushState(null, "", url);
        }
        showApplicationSurface("editor");
        document.title = suspendedEditorTitle;
        markStartupTiming("editor-surface-resumed", { source: "same-project" });
        publishStartupTiming("editor-surface-resumed");
        return;
      }
      // Document dimensions are compile-time WebGPU constants. A different
      // project gets a fresh engine, while immutable HTTP assets stay cached.
      window.location.assign(url);
      return;
    }

    if (window.location.href !== url.href) {
      window.history.pushState(null, "", url);
    }
    const bootstrap: ProjectEditorBootstrap = {
      storage,
      storageReady,
      preloadedProjectId,
      preloadedProject,
      returnHome: () => showHome(true),
    };
    window.__projectEditorBootstrap = bootstrap;
    showApplicationSurface("editor");
    markStartupTiming("editor-surface-visible");
    await measureStartupTiming("editor-module-import", () => import("./main"));
    editorLoaded = true;
    suspendedEditorUrl = new URL(window.location.href);
  };

  window.addEventListener("popstate", () => {
    const target = new URL(window.location.href);
    if (!shouldOpenEditor(target.searchParams)) {
      void showHome(false);
      return;
    }
    if (editorLoaded && sameSuspendedProject(target)) {
      showApplicationSurface("editor");
      document.title = suspendedEditorTitle;
      return;
    }
    window.location.reload();
  });

  const search = new URLSearchParams(window.location.search);
  if (shouldOpenEditor(search)) {
    if (!editorDimensionsAreValid(search)) {
      const app = element<HTMLElement>(document, "app");
      app.hidden = true;
      app.inert = true;
      home.hidden = false;
      home.inert = false;
      document.title = "M1M4.COM — Invalid canvas size";
      const controller = await ensureHomeController();
      controller.showStatus("Canvas dimensions must be whole pixels from 64 to 4000.", true);
      return;
    }
    const projectId = search.get("project")?.trim() || null;
    const preloadedProject = projectId && search.get("newProject") !== "1"
      ? measureStartupTiming(
        "project-storage-load",
        async () => {
          await storageReady;
          return storage.loadProject(projectId);
        },
      )
      : null;
    if (preloadedProject) void preloadedProject.catch(() => null);
    const initialUrl = new URL(window.location.href);
    markStartupTiming("editor-open-request", {
      source: projectId
        ? (search.get("newProject") === "1"
          ? "new-project-deep-link"
          : "saved-project-deep-link")
        : "unsaved-editor-deep-link",
      documentWidth: parsedEditorDimension(search.get("documentWidth")) ?? 0,
      documentHeight: parsedEditorDimension(search.get("documentHeight")) ?? 0,
    });
    // Avoid adding a duplicate history entry for a direct editor deep link.
    window.history.replaceState(null, "", initialUrl);
    await openEditor(initialUrl, projectId, preloadedProject);
    return;
  }

  showApplicationSurface("home");
  document.title = "M1M4.COM — Projects";
  await ensureHomeController();
  markStartupTiming("home-interactive");
  publishStartupTiming("home-interactive");
}

void boot().catch((error) => {
  console.error("M1M4 startup failed:", error);
});
