import { InkDocument } from "../canvas/document";
import { displayInkColor } from "../canvas/brush";
import { PointerInput, type FinishedGesture, type Tool } from "../canvas/input";
import { selectStrokeIds, translateStrokeSelection } from "../canvas/lasso";
import { CanvasRenderer, type AnswerProjection } from "../canvas/render";
import type { Page } from "../canvas/types";
import {
  createPage,
  openPageRepository,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  serializeRecoveryRecord,
  startFreshAfterRecovery,
  StoredDataError,
  type PageRepository,
  type WorkspaceKind,
  type WorkspaceSummary,
} from "../db";
import type { EquationResult } from "../parser";
import { registerOfflineApp, type OfflineController, type OfflineStatus } from "../pwa";
import { EquationController, type CorrectionGuard, type LineView } from "./equations";
import { SaveQueue, type SaveStatus } from "./save-queue";
import { mountHome } from "./home";
import { NotebookStack } from "./notebook-stack";
import { mountShell, type Shell } from "./shell";

type Session = { document: InkDocument; corrections: Record<string, string> };

function resultText(result: EquationResult | null): string {
  if (!result) return "";
  if (result.kind === "value") return result.display;
  return result.kind === "undefined" ? "Undefined" : "Check expression";
}

function displayRead(read: string): string {
  return read.replaceAll("\u4e8c", "=");
}

function lineStatus(view: LineView): string {
  if (view.phase === "complete") return view.source === "corrected" ? "Corrected" : "Review read";
  if (view.phase === "incomplete") return view.rawRead ? "No final = read" : "No text recognized";
  if (view.phase === "unreadable") return "Needs review";
  return view.phase === "reading" ? "Reading" : "Queued";
}

function button(text: string, className: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = text;
  return element;
}

function pageActionIcon(path: string): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  const shape = document.createElementNS(namespace, "path");
  icon.setAttribute("class", "icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  shape.setAttribute("d", path);
  icon.append(shape);
  return icon;
}

function hueColor(hue: number): string {
  const sector = Math.floor(hue / 60);
  const fraction = (hue % 60) / 60;
  const middle = Math.round(255 * (sector % 2 === 0 ? fraction : 1 - fraction));
  const rgb = [
    [255, middle, 0], [middle, 255, 0], [0, 255, middle],
    [0, middle, 255], [middle, 0, 255], [255, 0, middle],
  ][sector];
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function colorHue(color: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  if (delta === 0) return 0;
  const sector = max === r ? (g - b) / delta
    : max === g ? (b - r) / delta + 2
      : (r - g) / delta + 4;
  return Math.round((sector * 60 + 360) % 360);
}

export class NotebookApp {
  private readonly shell: Shell;
  private readonly homeHost: HTMLElement;
  private readonly home: ReturnType<typeof mountHome>;
  private readonly stack: NotebookStack;
  private readonly renderer: CanvasRenderer;
  private readonly input: PointerInput;
  private readonly equations: EquationController;
  private readonly offline: OfflineController;
  private repository: PageRepository | null = null;
  private sessions = new Map<string, Session>();
  private activeId: string | null = null;
  private saveQueue: SaveQueue | null = null;
  private tool: Tool = "pen";
  private selectedLineId: string | null = null;
  private correctionGuard: CorrectionGuard | null = null;
  private correctionSelection = "";
  private conflicts = new Set<string>();
  private deletingId: string | null = null;
  private recoveryError: StoredDataError | null = null;
  private busy = false;
  private saveFailed = false;
  private announcedResults = new Map<string, string>();
  private editRevision = 0;
  private rendererWarning: string | null = null;
  private pageIds: string[] = [];
  private workspaceRecord: WorkspaceSummary | null = null;
  private boardCamera = { x: 0, y: 0, scale: 1 };
  private colors: Record<WorkspaceKind, string> = {
    notebook: "#d9ddde",
    whiteboard: "#ffffff",
  };
  private zoomMode: "fit" | "custom" = "fit";
  private zoom = 1;
  private color = "#d9ddde";
  private penOnly = false;
  private selectedStrokeIds = new Set<string>();
  private movingSelection = false;

  constructor(root: HTMLElement) {
    this.shell = mountShell(root);
    this.homeHost = document.createElement("div");
    this.homeHost.hidden = true;
    document.body.append(this.homeHost);
    this.home = mountHome(this.homeHost, {
      items: [],
      onCreate: (kind) => void this.createWorkspace(kind),
      onOpen: (id) => void this.openWorkspace(id),
    });
    this.stack = new NotebookStack(
      this.shell.notebookStack,
      this.shell.workspace,
      this.shell.paperWrap,
      (id) => this.repository?.getPage(id) ?? Promise.resolve(null),
      (id) => void this.switchPage(id, false),
      (message) => this.showError(message),
    );
    this.renderer = new CanvasRenderer(
      this.shell.paper,
      {
        ink: this.shell.inkCanvas,
        answers: this.shell.answerCanvas,
        draft: this.shell.draftCanvas,
      },
      (message) => {
        const previous = this.rendererWarning;
        this.rendererWarning = message;
        if (message) this.showError(message);
        else if (previous && this.shell.errorText.textContent === previous) this.clearError();
      },
      (conflicts) => {
        this.conflicts = new Set(conflicts);
        this.renderReadback();
      },
    );
    this.equations = new EquationController(
      () => this.renderRecognition(),
      (corrections) => {
        const session = this.currentSession();
        if (!session) return;
        session.corrections = corrections;
        session.document.touchUpdatedAt();
        this.saveCurrent();
      },
    );
    this.input = new PointerInput(
      this.shell.drawingSurface,
      this.shell.workspace,
      () => this.tool,
      () => this.tool === "pen" || this.tool === "pencil"
        ? Number(this.shell.penWidth.value)
        : this.tool === "stroke-eraser" ? 13 : this.tool === "lasso" ? 2 : 9,
      (draft) => this.renderer.setDraft(draft),
      (gesture) => this.finishGesture(gesture),
      {
        getColor: () => this.color,
        getPenOnly: () => this.penOnly,
        onPinch: (factor, center) => this.pinchZoom(factor, center),
        mapPoint: (point) => this.workspaceRecord?.kind === "whiteboard"
          ? {
            x: this.boardCamera.x + point.x / this.boardCamera.scale,
            y: this.boardCamera.y + point.y / this.boardCamera.scale,
          }
          : point,
        onPan: (dx, dy) => {
          if (this.workspaceRecord?.kind === "whiteboard") {
            this.boardCamera.x -= dx / this.boardCamera.scale;
            this.boardCamera.y -= dy / this.boardCamera.scale;
            this.renderBoardCamera();
          } else {
            this.shell.workspace.scrollLeft -= dx;
            this.shell.workspace.scrollTop -= dy;
          }
        },
      },
    );
    try {
      this.penOnly = localStorage.getItem("calcink:pen-only") === "true";
    } catch {
      this.penOnly = false;
    }
    this.bindControls();
    this.offline = registerOfflineApp((status) => this.renderOffline(status));
    window.addEventListener("online", () => this.renderOffline(this.offline.current()));
    window.addEventListener("offline", () => this.renderOffline(this.offline.current()));
    window.addEventListener("resize", () => {
      if (this.zoomMode === "fit") this.fitPage();
    });
    window.addEventListener("beforeunload", (event) => {
      this.saveBoardCamera();
      if (this.saveQueue?.hasUnsavedChanges()
        || (!this.saveQueue && !!this.currentSession()?.document.strokes.length)) {
        event.preventDefault();
      }
    });
  }

  async start(): Promise<void> {
    try {
      this.repository = await openPageRepository();
      await this.showLibrary();
    } catch (error) {
      this.repository?.close();
      this.repository = null;
      this.recoveryError = error instanceof StoredDataError ? error : null;
      this.openEphemeralPage();
      this.showError(this.recoveryError
        ? "Stored notebook data could not be read. The original record is unchanged. Export it before starting a new page."
        : `Local storage is unavailable: ${this.errorMessage(error)}. Ink in this session is not saved.`);
    }
  }

  private currentSession(): Session | null {
    return this.activeId ? this.sessions.get(this.activeId) ?? null : null;
  }

  private isA4(page: Page | undefined = this.currentSession()?.document.page): boolean {
    return page?.schemaVersion === 3 && page.geometry === "a4";
  }

  private loadBoardCamera(id: string): { x: number; y: number; scale: number } {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(`calcink:camera:${id}`) ?? "null");
      if (value && typeof value === "object") {
        const camera = value as { x?: unknown; y?: unknown; scale?: unknown };
        if (typeof camera.x === "number" && Number.isFinite(camera.x) && Math.abs(camera.x) <= 1e7
          && typeof camera.y === "number" && Number.isFinite(camera.y) && Math.abs(camera.y) <= 1e7
          && typeof camera.scale === "number" && camera.scale >= 0.25 && camera.scale <= 4) {
          return { x: camera.x, y: camera.y, scale: camera.scale };
        }
      }
    } catch { /* Board ink remains safe when view preferences are unavailable. */ }
    return { x: 0, y: 0, scale: 1 };
  }

  private saveBoardCamera(): void {
    if (this.workspaceRecord?.kind !== "whiteboard") return;
    try {
      localStorage.setItem(
        `calcink:camera:${this.workspaceRecord.id}`,
        JSON.stringify(this.boardCamera),
      );
    } catch { /* Camera position is nonessential; strokes are saved in IndexedDB. */ }
  }

  private renderBoardCamera(): void {
    this.renderer.setCamera(this.boardCamera);
    const grid = 28 * this.boardCamera.scale;
    this.shell.paper.style.backgroundSize = `${grid}px ${grid}px`;
    this.shell.paper.style.backgroundPosition =
      `${-this.boardCamera.x * this.boardCamera.scale}px ${-this.boardCamera.y * this.boardCamera.scale}px`;
    this.updateAnswerVisibility();
  }

  private setZoom(value: number, mode: "fit" | "custom"): void {
    if (!this.isA4()) return;
    this.zoom = Math.max(0.25, Math.min(2, value));
    this.zoomMode = mode;
    const wrap = this.shell.paper.parentElement;
    if (!wrap) return;
    wrap.style.width = `${PAGE_WIDTH * this.zoom}px`;
    wrap.style.height = `${PAGE_HEIGHT * this.zoom}px`;
    wrap.style.minHeight = "0";
    wrap.style.setProperty("--page-display-height", `${PAGE_HEIGHT * this.zoom}px`);
    this.shell.paper.style.transformOrigin = "top left";
    this.shell.paper.style.transform = `scale(${this.zoom})`;
    const percent = Math.round(this.zoom * 100);
    this.shell.zoomSlider.value = String(percent);
    this.shell.zoomValue.value = `${percent}%`;
    this.stack.setZoom(this.zoom);
    this.updateAnswerVisibility();
  }

  private fitPage(): void {
    if (!this.isA4()) return;
    const workspace = this.shell.workspace;
    const css = getComputedStyle(workspace);
    const width = workspace.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - 4;
    const height = workspace.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) - 48;
    this.setZoom(Math.min(width / PAGE_WIDTH, height / PAGE_HEIGHT, 1), "fit");
  }

  private pinchZoom(factor: number, center: { x: number; y: number }): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (this.workspaceRecord?.kind === "whiteboard") {
      const bounds = this.shell.paper.getBoundingClientRect();
      const localX = center.x - bounds.left;
      const localY = center.y - bounds.top;
      const before = this.boardCamera;
      const scale = Math.max(0.25, Math.min(4, before.scale * factor));
      this.boardCamera = {
        x: before.x + localX / before.scale - localX / scale,
        y: before.y + localY / before.scale - localY / scale,
        scale,
      };
      this.renderBoardCamera();
      return;
    }
    if (!this.isA4()) return;
    const before = this.shell.paper.getBoundingClientRect();
    const worldX = (center.x - before.left) / this.zoom;
    const worldY = (center.y - before.top) / this.zoom;
    this.setZoom(this.zoom * factor, "custom");
    const after = this.shell.paper.getBoundingClientRect();
    this.shell.workspace.scrollLeft += after.left + worldX * this.zoom - center.x;
    this.shell.workspace.scrollTop += after.top + worldY * this.zoom - center.y;
  }

  private applyPageAppearance(page: Page): void {
    const a4 = this.isA4(page);
    const board = this.workspaceRecord?.kind === "whiteboard";
    const wrap = this.shell.paper.parentElement;
    wrap?.classList.toggle("a4-page", a4);
    this.showTemplate(board ? "blank" : page.schemaVersion === 3 ? page.template : "ruled");
    if (board) {
      this.renderBoardCamera();
      this.renderer.setPageSize(null);
    } else {
      this.renderer.setPageSize(a4 ? { width: PAGE_WIDTH, height: PAGE_HEIGHT } : null);
      this.renderer.setCamera(null);
      this.shell.paper.style.removeProperty("background-size");
      this.shell.paper.style.removeProperty("background-position");
    }
    this.shell.zoomSlider.disabled = !a4;
    this.shell.printPage.disabled = !a4;
    if (a4) {
      if (this.zoomMode === "fit") this.fitPage();
      else this.setZoom(this.zoom, this.zoomMode);
    } else {
      if (wrap) {
        wrap.style.removeProperty("width");
        wrap.style.removeProperty("height");
        wrap.style.removeProperty("min-height");
        wrap.style.removeProperty("--page-display-height");
      }
      this.shell.paper.style.removeProperty("transform");
    }
  }

  private async showLibrary(): Promise<void> {
    if (!this.repository) return;
    try {
      await this.saveQueue?.flush();
      const workspaces = await this.repository.listWorkspaces();
      this.home.update(workspaces.map(({ id, kind, title }) => ({ id, kind, title })));
      this.input.cancel();
      this.closeColors();
      this.closeTemplates();
      this.closeMore();
      this.saveBoardCamera();
      this.workspaceRecord = null;
      this.shell.root.hidden = true;
      this.homeHost.hidden = false;
    } catch (error) {
      this.showError(`Could not open library: ${this.errorMessage(error)}`);
    }
  }

  private printCurrentPage(): void {
    if (this.workspaceRecord?.kind !== "notebook" || !this.isA4()) {
      this.showError("A4 print is available for the selected A4 page.");
      return;
    }
    if (this.conflicts.size) {
      this.showError("Some answers do not fit on this page. Check Readback before printing.");
      return;
    }
    if (this.equations.lines.some((line) =>
      line.phase === "queued" || line.phase === "reading"
    )) {
      this.showError("Wait for the current handwriting read to finish before printing.");
      return;
    }
    window.print();
  }

  private async createWorkspace(kind: WorkspaceKind): Promise<void> {
    if (!this.repository || this.busy) return;
    this.setBusy(true);
    try {
      const existing = await this.repository.listWorkspaces();
      const prefix = kind === "notebook" ? "Notebook" : "Black canvas";
      let number = 1;
      while (existing.some((item) => item.title === `${prefix} ${number}`)) number += 1;
      const title = `${prefix} ${number}`;
      const workspace = await this.repository.createWorkspace(kind, title);
      await this.openWorkspace(workspace.id, true);
    } catch (error) {
      window.alert(`Could not create work: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private async openWorkspace(id: string, allowBusy = false): Promise<boolean> {
    if (!this.repository || (this.busy && !allowBusy)) return false;
    const wasBusy = this.busy;
    const wasHome = !this.homeHost.hidden;
    this.setBusy(true);
    try {
      const workspace = await this.repository.getWorkspace(id);
      if (!workspace) throw new Error("This workspace no longer exists");
      this.zoomMode = "fit";
      if (workspace.kind === "whiteboard") {
        this.shell.workspace.append(this.shell.paperWrap);
        this.stack.clear();
        this.boardCamera = this.loadBoardCamera(workspace.id);
      }
      this.workspaceRecord = workspace;
      this.shell.root.dataset.mode = workspace.kind;
      this.shell.workspace.dataset.mode = workspace.kind;
      const blackSwatch = this.shell.colorButtons.find((button) => button.dataset.color === "#121619");
      if (blackSwatch) {
        blackSwatch.setAttribute("aria-label", workspace.kind === "notebook"
          ? "Use adaptive dark ink, displayed light on notebook pages" : "Use Black ink");
        blackSwatch.title = workspace.kind === "notebook" ? "Adaptive dark ink" : "Black";
      }
      this.shell.root.hidden = false;
      this.homeHost.hidden = true;
      this.setColor(this.colors[workspace.kind]);
      const storedActive = await this.repository.getActivePageId();
      const pageId = storedActive && workspace.pageIds.includes(storedActive)
        ? storedActive : workspace.pageIds[0];
      if (!pageId || !await this.activatePage(pageId)) throw new Error("Workspace has no page");
      if (workspace.kind === "notebook") this.stack.reveal(pageId);
      return true;
    } catch (error) {
      const message = `Could not open workspace: ${this.errorMessage(error)}`;
      if (wasHome) {
        this.shell.root.hidden = true;
        this.homeHost.hidden = false;
        window.alert(message);
      } else {
        this.showError(message);
      }
      return false;
    } finally {
      this.setBusy(wasBusy);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private showError(message: string): void {
    this.shell.errorText.textContent = message;
    this.shell.errorBanner.hidden = false;
    this.shell.exportRecovery.hidden = !this.recoveryError
      || serializeRecoveryRecord(this.recoveryError) === null;
    this.shell.startFresh.hidden = !this.recoveryError;
    this.shell.retryStorage.hidden = !!this.saveQueue || !!this.recoveryError;
  }

  private clearError(): void {
    if (!this.recoveryError) this.shell.errorBanner.hidden = true;
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    if (value) this.input.cancel();
    this.shell.drawingSurface.style.pointerEvents = value ? "none" : "";
    this.updateControls();
  }

  private openEphemeralPage(): void {
    const page = createPage("Unsaved page");
    this.sessions.set(page.id, { document: new InkDocument(page), corrections: {} });
    this.activeId = page.id;
    this.saveQueue = null;
    this.applyPageAppearance(page);
    this.renderer.setInk([]);
    this.renderer.setAnswers([]);
    this.shell.liveRegion.textContent = "";
    this.equations.setPage(page, {});
    this.shell.pageTitle.textContent = page.title;
    this.shell.pagePosition.textContent = "Temporary page";
    this.updateSaveStatus("not-saved");
    this.updateControls();
  }

  private async activatePage(id: string): Promise<boolean> {
    if (!this.repository) return false;
    const wasBusy = this.busy;
    this.setBusy(true);
    try {
      if (this.activeId && this.activeId !== id) {
        try {
          await this.saveQueue?.flush();
        } catch (error) {
          this.showError(`Page not switched. Save failed: ${this.errorMessage(error)}`);
          return false;
        }
      }
      let session = this.sessions.get(id);
      if (!session) {
        const record = await this.repository.getPage(id);
        if (!record) throw new Error("The requested page no longer exists");
        session = { document: new InkDocument(record.page), corrections: { ...record.corrections } };
        this.sessions.set(id, session);
      }
      if (this.activeId !== id) await this.repository.setActivePageId(id);
      this.activeId = id;
      this.saveQueue = new SaveQueue(
        (record) => this.repository!.savePage(record),
        (status) => this.updateSaveStatus(status),
      );
      this.updateSaveStatus("saved");
      this.shell.pageTitle.textContent = session.document.page.title;
      this.applyPageAppearance(session.document.page);
      this.renderer.setInk(session.document.strokes);
      this.clearSelection();
      this.input.setTimeFloor(this.latestPointTime(session.document.page));
      this.selectedLineId = null;
      this.correctionGuard = null;
      this.correctionSelection = "";
      this.shell.liveRegion.textContent = "";
      this.equations.setPage(session.document.page, session.corrections);
      this.updateControls();
      this.clearError();
      await this.refreshPages();
      if (this.shell.pagesDialog.open) this.shell.pagesDialog.close();
      return true;
    } finally {
      this.setBusy(wasBusy);
    }
  }

  private latestPointTime(page: Page): number {
    let latest = 0;
    for (const stroke of page.strokes) {
      for (const point of stroke.points) latest = Math.max(latest, point.t ?? 0);
    }
    return latest;
  }

  private announceStatus(message: string): void {
    if (this.shell.systemAnnouncement.textContent !== message) {
      this.shell.systemAnnouncement.textContent = message;
    }
  }

  private updateSaveStatus(status: SaveStatus): void {
    const labels = {
      saved: "Saved on this device",
      saving: "Saving to this device",
      "not-saved": "Not saved",
    };
    const previous = this.shell.saveStatus.textContent;
    this.shell.saveStatus.textContent = labels[status];
    this.shell.saveStatus.dataset.tone = status === "not-saved" ? "error"
      : status === "saving" ? "warning" : "ok";
    this.shell.retrySave.hidden = status !== "not-saved" || !this.saveQueue;
    if (status === "not-saved") {
      this.saveFailed = true;
      if (previous !== labels["not-saved"]) this.announceStatus("Changes are not saved.");
    } else if (status === "saving" && this.saveFailed) {
      this.announceStatus("Retrying save.");
    } else if (status === "saved" && this.saveFailed) {
      this.saveFailed = false;
      this.announceStatus("Saved on this device.");
    }
  }

  private renderOffline(status: OfflineStatus): void {
    const previous = this.shell.offlineStatus.textContent;
    const message = status.kind === "ready" && !navigator.onLine
      ? "Offline; app assets installed"
      : status.message;
    this.shell.offlineStatus.textContent = message;
    this.shell.offlineStatus.title = message;
    this.shell.offlineStatus.dataset.tone = status.kind === "ready" ? "ok"
      : status.kind === "failed" || (status.kind === "unavailable" && !import.meta.env.DEV)
        ? "error" : "warning";
    this.shell.updateButton.hidden = status.kind !== "update_available";
    this.shell.retryOffline.hidden = status.kind !== "failed";
    if (message !== previous && (
      status.kind !== "downloading" || message.startsWith("Retrying")
    )) this.announceStatus(message);
  }

  private updateControls(): void {
    const session = this.currentSession();
    const document = session?.document;
    for (const control of this.shell.toolButtons) {
      control.disabled = !document || this.busy;
      control.setAttribute("aria-pressed", String(control.dataset.tool === this.tool));
    }
    this.shell.penWidth.disabled = !document || this.busy;
    this.shell.undoButton.disabled = this.busy || !document?.canUndo;
    this.shell.redoButton.disabled = this.busy || !document?.canRedo;
    this.shell.clearButton.disabled = this.busy || !document || document.strokes.length === 0;
    this.shell.clearMenuButton.disabled = this.shell.clearButton.disabled;
    const notebook = this.workspaceRecord?.kind === "notebook";
    this.shell.pagesButton.disabled = this.busy || !this.repository || !notebook;
    this.shell.pagesButton.hidden = !notebook;
    this.shell.quickNewPage.hidden = !notebook;
    this.shell.quickNewPage.disabled = this.busy || !this.repository || !notebook;
    this.shell.prevPage.disabled = this.busy || this.pageIds.indexOf(this.activeId ?? "") <= 0;
    this.shell.nextPage.disabled = this.busy
      || this.pageIds.indexOf(this.activeId ?? "") >= this.pageIds.length - 1;
    const hasSelection = this.selectedStrokeIds.size > 0;
    this.shell.lassoMove.disabled = this.busy || !hasSelection;
    this.shell.lassoDelete.disabled = this.busy || !hasSelection;
    this.shell.lassoCancel.disabled = this.busy || !hasSelection;
    this.shell.colorMenuButton.disabled = this.busy || !document;
    this.shell.printPage.disabled = this.busy || !notebook || !this.isA4();
    this.shell.printPage.hidden = !notebook;
    this.shell.paperTemplate.disabled = !document || this.busy || !notebook;
    const templateControl = this.shell.paperTemplate.closest<HTMLElement>(".template-control");
    if (templateControl) templateControl.hidden = !notebook;
    this.shell.lassoActions.hidden = !hasSelection;
    this.shell.penOnlyMode.checked = this.penOnly;
    this.shell.drawingSurface.setAttribute("aria-label",
      `${notebook ? "Writable paper" : "Writable canvas"}. ${
        this.penOnly
          ? "Use one finger to scroll or pan; use a stylus or mouse to draw."
          : "Use one finger, a stylus, or a mouse to draw; use two fingers to pan."
      }`);
  }

  private setTool(tool: Tool): void {
    if (tool !== "lasso") this.clearSelection();
    this.tool = tool;
    this.updateControls();
  }

  private clearSelection(): void {
    this.selectedStrokeIds.clear();
    this.movingSelection = false;
    this.renderer.setSelection([]);
    this.updateControls();
  }

  private finishGesture(gesture: FinishedGesture): void {
    if (this.busy) return;
    const document = this.currentSession()?.document;
    if (!document) return;
    let changed: boolean;
    try {
      if (gesture.tool === "lasso") {
        if (this.movingSelection) {
          this.movingSelection = false;
          const first = gesture.points[0];
          const last = gesture.points.at(-1);
          if (!first || !last) return;
          const moved = translateStrokeSelection(
            document.strokes,
            this.selectedStrokeIds,
            last.x - first.x,
            last.y - first.y,
            this.workspaceRecord?.kind === "whiteboard"
              ? null
              : this.isA4()
              ? { width: PAGE_WIDTH, height: PAGE_HEIGHT }
              : { width: this.shell.paper.clientWidth, height: this.shell.paper.clientHeight },
          );
          if (!moved) {
            this.showError("Selection cannot move beyond the page edge.");
            return;
          }
          changed = document.replaceSelectedStrokes(this.selectedStrokeIds, moved);
        } else {
          this.selectedStrokeIds = selectStrokeIds(document.strokes, gesture.points);
          this.renderer.setSelection(
            document.strokes.filter((stroke) => this.selectedStrokeIds.has(stroke.id)),
          );
          this.updateControls();
          return;
        }
      } else if (gesture.tool === "pen" || gesture.tool === "pencil") {
        const radius = gesture.width / 2;
        const points = this.isA4()
          ? gesture.points.map((point) => ({
            ...point,
            x: Math.max(radius, Math.min(PAGE_WIDTH - radius, point.x)),
            y: Math.max(radius, Math.min(PAGE_HEIGHT - radius, point.y)),
          })) : gesture.points;
        changed = document.addStroke({
          id: crypto.randomUUID(),
          width: gesture.width,
          color: gesture.color,
          style: gesture.style,
          points,
        });
      } else if (gesture.tool === "stroke-eraser") {
        changed = document.eraseStrokes(gesture.points, gesture.width);
      } else {
        changed = document.erasePixels(gesture.points, gesture.width);
      }
    } catch (error) {
      this.showError(`Ink edit failed: ${this.errorMessage(error)}`);
      return;
    }
    if (changed) this.inkChanged();
  }

  private inkChanged(): void {
    const session = this.currentSession();
    if (!session) return;
    this.clearSelection();
    this.renderer.setInk(session.document.strokes);
    this.shell.liveRegion.textContent = "";
    this.equations.inkChanged(session.document.page);
    this.saveCurrent();
    this.updateControls();
  }

  private saveCurrent(): void {
    const session = this.currentSession();
    if (!session) return;
    this.editRevision += 1;
    if (!this.saveQueue) {
      this.updateSaveStatus("not-saved");
      return;
    }
    this.saveQueue.enqueue({ page: session.document.page, corrections: session.corrections });
  }

  private async flushCurrentSave(): Promise<void> {
    if (!this.saveQueue) throw new Error("The current page is not connected to local storage");
    await this.saveQueue.flush();
  }

  private undo(): void {
    if (this.busy) return;
    if (this.currentSession()?.document.undo()) this.inkChanged();
  }

  private redo(): void {
    if (this.busy) return;
    if (this.currentSession()?.document.redo()) this.inkChanged();
  }

  private renderRecognition(): void {
    const status = this.equations.status;
    const labels = {
      loading: "Loading recognition",
      ready: "Recognition ready",
      reading: "Reading handwriting",
      unavailable: "Recognition unavailable",
    };
    const previous = this.shell.recognitionStatus.textContent;
    this.shell.recognitionStatus.textContent = labels[status];
    this.shell.recognitionStatus.dataset.tone = status === "unavailable" ? "error"
      : status === "loading" || status === "reading" ? "warning" : "ok";
    this.shell.retryRecognition.hidden = status !== "unavailable";
    if (status === "unavailable" && previous !== labels.unavailable) {
      this.announceStatus("Recognition unavailable. Retry recognition or correct a line in Readback.");
    } else if (status === "ready" && (
      previous === labels.loading || previous === labels.unavailable
    )) {
      this.announceStatus("Recognition ready.");
    } else if (status === "loading" && previous === labels.unavailable) {
      this.announceStatus("Retrying recognition.");
    }
    const projections = this.equations.lines.flatMap<AnswerProjection>((view) => {
      if (view.phase === "unreadable") {
        return [{
          lineId: view.line.lineId,
          anchor: view.line.anchor,
          text: "Fix in Readback",
          source: "attention",
        }];
      }
      if (view.phase !== "complete" || view.result?.kind === "syntax") return [];
      return [{
        lineId: view.line.lineId,
        anchor: view.line.anchor,
        inkHeight: view.line.bounds.bottom - view.line.bounds.top,
        text: resultText(view.result),
        source: view.source ?? "automatic",
      }];
    });
    this.conflicts = this.renderer.setAnswers(projections);
    this.updateAnswerVisibility();
    this.renderReadback();
  }

  private updateAnswerVisibility(): void {
    const edge = this.renderer.rightmostAnswerEdge();
    if (edge === null) {
      this.shell.revealAnswer.hidden = true;
      return;
    }
    const screenEdge = this.workspaceRecord?.kind === "whiteboard"
      ? this.shell.paper.getBoundingClientRect().left
        + (edge - this.boardCamera.x) * this.boardCamera.scale
      : this.shell.paper.getBoundingClientRect().left
        + edge * (this.isA4() ? this.zoom : 1);
    this.shell.revealAnswer.hidden =
      screenEdge <= this.shell.workspace.getBoundingClientRect().right - 8;
  }

  private renderReadback(): void {
    const views = this.equations.lines;
    const pagePrefix = `${this.activeId}:`;
    const currentLines = new Set(views.map((view) => `${pagePrefix}${view.line.lineId}`));
    for (const key of this.announcedResults.keys()) {
      if (key.startsWith(pagePrefix) && !currentLines.has(key)) this.announcedResults.delete(key);
    }
    if (!views.some((view) => view.line.lineId === this.selectedLineId)) {
      this.selectedLineId = views[0]?.line.lineId ?? null;
      this.correctionSelection = "";
      this.correctionGuard = null;
    }
    this.shell.lineList.replaceChildren();
    views.forEach((view, index) => {
      const choice = button(`Line ${index + 1}`, "line-choice");
      const status = document.createElement("small");
      status.textContent = lineStatus(view);
      choice.append(status);
      choice.setAttribute("aria-current", String(view.line.lineId === this.selectedLineId));
      choice.addEventListener("click", () => this.selectLine(view.line.lineId));
      this.shell.lineList.append(choice);
    });
    this.shell.readbackEmpty.hidden = views.length > 0;
    const selected = views.find((view) => view.line.lineId === this.selectedLineId);
    this.shell.lineDetail.hidden = !selected;
    this.shell.sampleExport.hidden = !selected || !this.equations.hasFirstRead(selected.line.lineId);
    if (!selected) return;
    this.shell.selectedLineLabel.textContent =
      `Line ${views.findIndex((view) => view.line.lineId === selected.line.lineId) + 1}`;
    this.shell.selectedLineStatus.textContent = lineStatus(selected);
    let tone = "warning";
    if (selected.phase === "unreadable") tone = "error";
    else if (selected.phase === "complete" && selected.source !== "corrected") tone = "ok";
    this.shell.selectedLineStatus.dataset.tone = tone;
    this.shell.lineDetail.dataset.source = selected.source ?? "";
    this.shell.lineDetail.dataset.tone = selected.phase === "unreadable" ? "error" : "";
    const selectionKey = `${selected.line.lineId}:${this.equations.canvasRevisionId}`;
    if (selectionKey !== this.correctionSelection) {
      const editingOldRead = document.activeElement === this.shell.correctionInput
        && this.shell.correctionInput.value.trim().length > 0
        && this.correctionGuard?.lineId === selected.line.lineId;
      if (!editingOldRead) {
        this.correctionSelection = selectionKey;
        this.correctionGuard = this.equations.guardFor(selected.line.lineId);
        this.shell.correctionInput.value = displayRead(selected.normalizedRead || selected.rawRead);
        this.shell.correctionError.hidden = true;
        this.shell.correctionInput.removeAttribute("aria-invalid");
      }
    } else if (!this.shell.correctionInput.value && selected.normalizedRead) {
      this.shell.correctionInput.value = selected.normalizedRead;
    }
    this.shell.rawRead.textContent = displayRead(selected.rawRead) ||
      (selected.source === "corrected" ? "No OCR read retained"
        : this.equations.hasFirstRead(selected.line.lineId) ? "No text recognized" : "Not read yet");
    this.shell.unmaskedRead.hidden =
      !selected.unmaskedRawRead || selected.unmaskedRawRead === selected.rawRead;
    this.shell.unmaskedRead.textContent = `Unrestricted OCR read: ${displayRead(selected.unmaskedRawRead)}`;
    this.shell.normalizedRead.textContent = selected.normalizedRead || "Not available";
    this.shell.lineResult.textContent = selected.result
      ? `${resultText(selected.result)} ${selected.source === "corrected" ? "(corrected)" : "(review read)"}`
      : "";
    const reason = selected.result?.kind === "undefined"
      ? selected.result.reason === "division_by_zero"
        ? "Division by zero."
        : "Result is outside the supported numeric range."
      : "";
    this.shell.lineMessage.textContent = [
      this.conflicts.has(selected.line.lineId)
        ? "The answer would overlap ink. It is shown here instead."
        : "",
      selected.message,
      reason,
    ].filter(Boolean).join(" ");
    const announcements: string[] = [];
    views.forEach((view, index) => {
      const key = `${pagePrefix}${view.line.lineId}`;
      if (view.phase === "queued" || view.phase === "reading") {
        this.announcedResults.delete(key);
        return;
      }
      const expression = displayRead(view.normalizedRead || view.rawRead) || "unreadable ink";
      const outcome = view.phase === "complete"
        ? `${resultText(view.result)}. ${lineStatus(view)}.${view.message ? ` ${view.message}` : ""}`
        : `${view.message || lineStatus(view)}.`;
      const announcement = `Line ${index + 1}, ${expression}: ${outcome}`;
      const state = `${view.line.signature}:${expression}:${outcome}`;
      if (this.announcedResults.get(key) !== state) {
        this.announcedResults.set(key, state);
        announcements.push(announcement);
      }
    });
    if (announcements.length > 0) {
      this.shell.liveRegion.textContent = announcements.join(" ");
    }
  }

  private selectLine(id: string): void {
    this.selectedLineId = id;
    this.correctionSelection = "";
    this.renderReadback();
    this.shell.correctionInput.focus();
  }

  private showReadback(open: boolean): void {
    this.closeMore();
    this.shell.readbackButton.setAttribute("aria-expanded", String(open));
    if (open) {
      this.shell.readbackPanel.hidden = false;
      this.shell.readbackPanel.showModal();
      this.shell.readbackHeading.focus();
    } else {
      if (this.shell.readbackPanel.open) this.shell.readbackPanel.close();
      this.shell.readbackPanel.hidden = true;
      this.shell.moreButton.focus();
    }
  }

  private closeMore(focus = false): void {
    this.shell.moreMenu.hidden = true;
    this.shell.moreButton.setAttribute("aria-expanded", "false");
    if (focus) this.shell.moreButton.focus();
  }

  private positionColors(): void {
    if (this.shell.colorPanel.hidden) return;
    const trigger = this.shell.colorMenuButton.getBoundingClientRect();
    const panel = this.shell.colorPanel;
    const width = panel.offsetWidth;
    const left = Math.max(10, Math.min(trigger.right - width + 8, window.innerWidth - width - 10));
    panel.style.left = `${left}px`;
    panel.style.bottom = `${window.innerHeight - trigger.top + 18}px`;
    panel.style.setProperty(
      "--picker-arrow-left",
      `${Math.max(18, Math.min(trigger.left + trigger.width / 2 - left - 6, width - 18))}px`,
    );
  }

  private closeColors(): void {
    this.shell.colorPanel.hidden = true;
    this.shell.colorMenuButton.setAttribute("aria-expanded", "false");
    this.shell.colorCustomPanel.hidden = true;
    this.shell.colorCustomToggle.setAttribute("aria-expanded", "false");
    this.shell.colorCustomError.hidden = true;
    this.shell.colorCustom.removeAttribute("aria-invalid");
  }

  private positionTemplates(): void {
    if (this.shell.templateMenu.hidden) return;
    const trigger = this.shell.paperTemplate.getBoundingClientRect();
    const panel = this.shell.templateMenu;
    const width = panel.offsetWidth;
    panel.style.left = `${Math.max(10, Math.min(trigger.right - width, window.innerWidth - width - 10))}px`;
    panel.style.bottom = `${window.innerHeight - trigger.top + 18}px`;
  }

  private closeTemplates(focus = false): void {
    this.shell.templateMenu.hidden = true;
    this.shell.paperTemplate.setAttribute("aria-expanded", "false");
    if (focus) this.shell.paperTemplate.focus();
  }

  private showTemplate(template: string): void {
    this.shell.paper.dataset.template = template;
    const label = template[0].toUpperCase() + template.slice(1);
    this.shell.paperTemplateLabel.textContent = label;
    this.shell.paperTemplate.setAttribute("aria-label", `Paper template: ${label}`);
    for (const button of this.shell.templateButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.template === template));
    }
  }

  private async refreshPages(): Promise<void> {
    if (!this.repository || !this.workspaceRecord) return;
    const summaries = await this.repository.listWorkspacePages(this.workspaceRecord.id);
    this.pageIds = summaries.map((summary) => summary.id);
    const activeIndex = summaries.findIndex((summary) => summary.id === this.activeId);
    this.shell.pagePosition.textContent = activeIndex >= 0
      ? `${activeIndex + 1} / ${summaries.length}` : "No page";
    if (this.workspaceRecord.kind === "notebook" && this.activeId) {
      this.stack.render(summaries, this.activeId, this.zoom);
    }
    this.updateControls();
    this.shell.pageList.replaceChildren();
    for (const [index, summary] of summaries.entries()) {
      const row = document.createElement("div");
      row.className = "page-row";
      row.dataset.active = String(summary.id === this.activeId);
      const switchButton = button("", "page-switch");
      const number = document.createElement("span");
      number.className = "page-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const label = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = summary.title;
      const subtitle = document.createElement("small");
      subtitle.textContent = summary.id === this.activeId ? "Current page" : "Open page";
      label.append(title, subtitle);
      switchButton.append(number, label);
      switchButton.setAttribute("aria-label", `Open ${summary.title}`);
      switchButton.addEventListener("click", () => void this.switchPage(summary.id));
      const rename = button("Rename", "page-rename-button");
      rename.prepend(pageActionIcon("M16 4l4 4-11 11-5 1 1-5L16 4zM14 6l4 4"));
      rename.setAttribute("aria-label", `Rename ${summary.title}`);
      rename.addEventListener("click", () => this.beginRename(row, summary.id, summary.title));
      const remove = button("Delete", "page-delete");
      remove.prepend(pageActionIcon("M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6.5 7l.8 14h9.4l.8-14"));
      remove.setAttribute("aria-label", `Delete ${summary.title}`);
      remove.addEventListener("click", () => this.askDelete(summary.id, summary.title));
      row.append(switchButton, rename, remove);
      this.shell.pageList.append(row);
    }
  }

  private beginRename(row: HTMLElement, id: string, title: string): void {
    const input = document.createElement("input");
    input.className = "page-rename";
    input.setAttribute("aria-label", `Rename ${title}`);
    input.maxLength = 80;
    input.value = title;
    row.replaceChildren(input);
    input.focus();
    input.select();
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      void this.refreshPages().catch((error: unknown) => this.showError(this.errorMessage(error)));
    };
    const commit = () => {
      if (finished) return;
      finished = true;
      void this.renamePage(id, input.value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); }
      if (event.key === "Enter") { event.preventDefault(); commit(); }
    });
    input.addEventListener("blur", commit);
  }

  private async renamePage(id: string, title: string): Promise<void> {
    if (!this.repository) return;
    try {
      let session = this.sessions.get(id);
      if (!session) {
        const record = await this.repository.getPage(id);
        if (!record) throw new Error("Page no longer exists");
        session = { document: new InkDocument(record.page), corrections: { ...record.corrections } };
      }
      const oldTitle = session.document.page.title;
      if (!session.document.setTitle(title)) {
        await this.refreshPages();
        return;
      }
      if (id === this.activeId) {
        this.shell.pageTitle.textContent = session.document.page.title;
        this.saveCurrent();
        await this.saveQueue?.flush();
      } else {
        try {
          await this.repository.savePage({
            page: session.document.page,
            corrections: session.corrections,
          });
          this.sessions.set(id, session);
        } catch (error) {
          session.document.setTitle(oldTitle);
          throw error;
        }
      }
      await this.refreshPages();
    } catch (error) {
      this.showError(`Rename failed: ${this.errorMessage(error)}`);
      await this.refreshPages().catch(() => {});
    }
  }

  private async switchPage(id: string, reveal = true): Promise<void> {
    if (this.busy || id === this.activeId) {
      if (id === this.activeId) this.shell.pagesDialog.close();
      return;
    }
    this.setBusy(true);
    try {
      if (await this.activatePage(id) && reveal) this.stack.reveal(id);
    } catch (error) {
      this.showError(`Page not switched: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private async addPage(): Promise<void> {
    if (this.busy || !this.repository || this.workspaceRecord?.kind !== "notebook") return;
    this.setBusy(true);
    this.shell.newPage.disabled = true;
    try {
      await this.saveQueue?.flush();
      const page = createPage();
      if (!this.activeId) throw new Error("No current page");
      await this.repository.insertPageAfter({ page, corrections: {} }, this.activeId);
      await this.activatePage(page.id);
      this.stack.reveal(page.id);
    } catch (error) {
      this.showError(`New page not opened: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
      this.shell.newPage.disabled = false;
      await this.refreshPages().catch(() => {});
    }
  }

  private askDelete(id: string, title: string): void {
    this.deletingId = id;
    this.shell.deleteMessage.textContent =
      `Delete "${title}" and its ink and corrections from this device? This cannot be undone.`;
    this.shell.deleteDialog.showModal();
  }

  private async deletePage(): Promise<void> {
    if (!this.repository || !this.deletingId || this.busy) return;
    this.setBusy(true);
    const id = this.deletingId;
    const wasActive = id === this.activeId;
    let committed = false;
    this.shell.confirmDelete.disabled = true;
    try {
      await this.saveQueue?.flush();
      await this.repository.deletePage(id);
      committed = true;
      this.sessions.delete(id);
      for (const key of this.announcedResults.keys()) {
        if (key.startsWith(`${id}:`)) this.announcedResults.delete(key);
      }
      if (wasActive) {
        this.activeId = null;
        this.saveQueue = null;
        const replacement = await this.repository.getActivePageId();
        if (!replacement) throw new Error("No replacement page exists");
        await this.activatePage(replacement);
        this.stack.reveal(replacement);
      }
      this.shell.deleteDialog.close();
      this.deletingId = null;
      await this.refreshPages();
      if (this.shell.pagesDialog.open) {
        this.shell.pageList.querySelector<HTMLButtonElement>(
          '.page-row[data-active="true"] .page-switch',
        )?.focus();
      }
    } catch (error) {
      if (committed && wasActive && !this.currentSession()) this.openEphemeralPage();
      this.showError(committed
        ? `The page was deleted, but the notebook could not finish reopening: ${this.errorMessage(error)}`
        : `Delete failed: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
      this.shell.confirmDelete.disabled = false;
    }
  }

  private exportRecovery(): void {
    if (!this.recoveryError) return;
    const data = serializeRecoveryRecord(this.recoveryError);
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "calcink-recovery-original.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private exportSample(): void {
    if (!this.selectedLineId || this.busy || !this.equations.hasFirstRead(this.selectedLineId)) return;
    const intended = window.prompt("Enter exactly what you wrote, including = if drawn.");
    if (intended === null) return;
    try {
      const sample = this.equations.diagnosticSampleFor(this.selectedLineId, intended, {
        userAgent: navigator.userAgent,
        language: navigator.language,
        devicePixelRatio: window.devicePixelRatio,
        online: navigator.onLine,
        exportedAt: new Date().toISOString(),
      });
      if (!sample) return;
      if (!window.confirm(
        "Export this line's handwriting and browser details to a JSON file on this device? CalcInk does not upload it.",
      )) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(sample, null, 2)], {
        type: "application/json",
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `calcink-sample-${sample.sampleId}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      this.showError(`Sample export failed: ${this.errorMessage(error)}`);
    }
  }

  private async startFresh(): Promise<void> {
    if (!this.recoveryError || this.busy) return;
    if (this.currentSession()?.document.strokes.length
      && !window.confirm("Unsaved ink on this temporary page will be lost. Start a new stored page?")) return;
    this.setBusy(true);
    const previousId = this.activeId;
    let candidate: PageRepository | null = null;
    try {
      candidate = await startFreshAfterRecovery();
      const active = await candidate.getActivePageId();
      if (!active) throw new Error("Recovery did not create a page");
      const workspace = (await candidate.listWorkspaces())
        .find((item) => item.pageIds.includes(active));
      if (!workspace) throw new Error("Recovery did not create a notebook");
      this.repository = candidate;
      if (!await this.openWorkspace(workspace.id, true)) {
        throw new Error("Could not open the new notebook");
      }
      if (previousId) this.sessions.delete(previousId);
      this.recoveryError = null;
      this.shell.errorBanner.hidden = true;
    } catch (error) {
      candidate?.close();
      this.repository = null;
      this.saveQueue = null;
      if (previousId && this.sessions.has(previousId)) {
        this.activeId = previousId;
        const previous = this.sessions.get(previousId)!;
        this.shell.pageTitle.textContent = previous.document.page.title;
        this.renderer.setInk(previous.document.strokes);
        this.equations.setPage(previous.document.page, previous.corrections);
      }
      this.updateSaveStatus("not-saved");
      this.showError(`Could not start a new page: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private async retryStorage(): Promise<void> {
    if (this.saveQueue || this.recoveryError || this.busy) return;
    const session = this.currentSession();
    if (!session) return;
    this.setBusy(true);
    let candidate: PageRepository | null = null;
    try {
      candidate = this.repository ?? await openPageRepository();
      const snapshotRevision = this.editRevision;
      const snapshot = {
        page: session.document.page,
        corrections: session.corrections,
      };
      const workspace = await candidate.savePageInNewNotebook(snapshot);
      this.repository = candidate;
      if (!await this.openWorkspace(workspace.id, true)) {
        throw new Error("Could not open the recovered notebook");
      }
      if (this.editRevision !== snapshotRevision) this.saveCurrent();
      await this.flushCurrentSave();
      this.shell.errorBanner.hidden = true;
    } catch (error) {
      candidate?.close();
      this.repository = null;
      this.saveQueue = null;
      this.updateSaveStatus("not-saved");
      this.recoveryError = error instanceof StoredDataError ? error : null;
      this.showError(`Local storage still is not ready: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private setColor(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    this.color = color.toLowerCase();
    const darkPaper = this.workspaceRecord?.kind === "notebook";
    const displayColor = displayInkColor(this.color, darkPaper);
    const adapted = displayColor !== this.color;
    if (this.workspaceRecord) this.colors[this.workspaceRecord.kind] = this.color;
    for (const button of this.shell.colorButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.color?.toLowerCase() === this.color));
    }
    this.shell.colorCustom.value = this.color;
    this.shell.colorHue.value = String(colorHue(this.color));
    this.shell.colorCustomPreview.style.backgroundColor = displayColor;
    const channel = [1, 3, 5].map((index) => parseInt(displayColor.slice(index, index + 2), 16));
    const luminance = channel.map((value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    const inkLuminance = luminance[0] * 0.2126
      + luminance[1] * 0.7152 + luminance[2] * 0.0722;
    const paperLuminance = this.workspaceRecord?.kind === "whiteboard" ? 0.008 : 0.018;
    const contrast = (Math.max(inkLuminance, paperLuminance) + 0.05)
      / (Math.min(inkLuminance, paperLuminance) + 0.05);
    this.shell.colorWarning.hidden = contrast >= 3 && !adapted;
    this.shell.colorWarning.textContent = adapted
      ? "Dark ink appears light on notebook pages so saved notes stay visible."
      : "This color may be hard to see on this paper.";
    this.shell.colorMenuButton.dataset.lowContrast = String(contrast < 3);
    this.shell.colorMenuButton.setAttribute("aria-label", contrast < 3
      ? "Choose ink color; current ink may be hard to see on this paper"
      : "Choose ink color");
    this.shell.colorMenuButton.title = contrast < 3
      ? "Ink color may be hard to see on this paper" : "Ink color";
    this.shell.colorMenuButton.style.setProperty("--selected-color", displayColor);
  }

  private bindControls(): void {
    this.shell.homeButton.addEventListener("click", () => void this.showLibrary());
    for (const control of this.shell.toolButtons) {
      control.addEventListener("click", () => this.setTool(control.dataset.tool as Tool));
    }
    const updateWidthDot = () => {
      const size = Math.min(11, Number(this.shell.penWidth.value) + 3);
      this.shell.widthDot.style.width = `${size}px`;
      this.shell.widthDot.style.height = `${size}px`;
    };
    this.shell.penWidth.addEventListener("input", () => {
      this.shell.widthValue.value = this.shell.penWidth.value;
      updateWidthDot();
    });
    updateWidthDot();
    this.shell.undoButton.addEventListener("click", () => this.undo());
    this.shell.redoButton.addEventListener("click", () => this.redo());
    const askClear = () => {
      this.closeMore();
      if (!this.busy && this.currentSession()?.document.strokes.length) {
        this.shell.clearDialog.showModal();
      }
    };
    this.shell.clearButton.addEventListener("click", askClear);
    this.shell.clearMenuButton.addEventListener("click", askClear);
    this.shell.cancelClear.addEventListener("click", () => this.shell.clearDialog.close());
    this.shell.confirmClear.addEventListener("click", () => {
      this.shell.clearDialog.close();
      if (!this.busy && this.currentSession()?.document.clear()) this.inkChanged();
    });
    this.shell.clearDialog.addEventListener("close", () => this.shell.clearButton.focus());
    this.shell.pagesButton.addEventListener("click", () => {
      this.closeMore();
      this.input.cancel();
      void this.refreshPages().then(() => this.shell.pagesDialog.showModal())
        .catch((error: unknown) => this.showError(this.errorMessage(error)));
    });
    this.shell.closePages.addEventListener("click", () => this.shell.pagesDialog.close());
    this.shell.pagesDialog.addEventListener("close", () => {
      if (document.activeElement === document.body
        || this.shell.pagesDialog.contains(document.activeElement)) this.shell.pagesButton.focus();
    });
    this.shell.newPage.addEventListener("click", () => void this.addPage());
    this.shell.quickNewPage.addEventListener("click", () => void this.addPage());
    this.shell.prevPage.addEventListener("click", () => {
      const index = this.pageIds.indexOf(this.activeId ?? "");
      if (index > 0) void this.switchPage(this.pageIds[index - 1]);
    });
    this.shell.nextPage.addEventListener("click", () => {
      const index = this.pageIds.indexOf(this.activeId ?? "");
      if (index >= 0 && index < this.pageIds.length - 1) {
        void this.switchPage(this.pageIds[index + 1]);
      }
    });
    this.shell.zoomSlider.addEventListener("input", () => {
      this.setZoom(this.shell.zoomSlider.valueAsNumber / 100, "custom");
    });
    this.shell.workspace.addEventListener("wheel", (event) => {
      if (this.workspaceRecord?.kind !== "whiteboard") return;
      event.preventDefault();
      if (event.ctrlKey) {
        this.pinchZoom(Math.exp(-event.deltaY * 0.002), {
          x: event.clientX,
          y: event.clientY,
        });
      } else {
        this.boardCamera.x += event.deltaX / this.boardCamera.scale;
        this.boardCamera.y += event.deltaY / this.boardCamera.scale;
        this.renderBoardCamera();
      }
    }, { passive: false });
    this.shell.printPage.addEventListener("click", () => this.printCurrentPage());
    this.shell.lassoMove.addEventListener("click", () => {
      if (!this.selectedStrokeIds.size) return;
      this.movingSelection = true;
      this.announceStatus("Drag on the page to move selected strokes.");
    });
    this.shell.lassoDelete.addEventListener("click", () => {
      const page = this.currentSession()?.document;
      if (page && page.replaceSelectedStrokes(this.selectedStrokeIds, null)) this.inkChanged();
    });
    this.shell.lassoCancel.addEventListener("click", () => this.clearSelection());
    this.shell.colorMenuButton.addEventListener("click", () => {
      if (!this.shell.colorPanel.hidden) {
        this.closeColors();
        return;
      }
      this.closeTemplates();
      this.shell.colorPanel.hidden = false;
      this.shell.colorMenuButton.setAttribute("aria-expanded", "true");
      this.positionColors();
      this.shell.colorButtons[0]?.focus();
    });
    for (const button of this.shell.colorButtons) {
      button.addEventListener("click", () => {
        this.setColor(button.dataset.color ?? "");
        this.setTool("pen");
        this.closeColors();
        this.shell.colorMenuButton.focus();
      });
    }
    this.shell.colorCustomToggle.addEventListener("click", () => {
      const opening = this.shell.colorCustomPanel.hidden;
      this.shell.colorCustomPanel.hidden = !opening;
      this.shell.colorCustomToggle.setAttribute("aria-expanded", String(opening));
      this.shell.colorCustomError.hidden = true;
      this.shell.colorCustom.removeAttribute("aria-invalid");
      if (opening) {
        this.shell.colorCustom.value = this.color;
        this.shell.colorHue.value = String(colorHue(this.color));
        this.shell.colorCustomPreview.style.backgroundColor = displayInkColor(
          this.color, this.workspaceRecord?.kind === "notebook",
        );
        this.shell.colorHue.focus();
      } else {
        this.shell.colorCustomToggle.focus();
      }
      this.positionColors();
    });
    this.shell.colorHue.addEventListener("input", () => {
      const color = hueColor(Number(this.shell.colorHue.value));
      this.shell.colorCustom.value = color;
      this.shell.colorCustomPreview.style.backgroundColor = displayInkColor(
        color, this.workspaceRecord?.kind === "notebook",
      );
      this.shell.colorCustomError.hidden = true;
      this.shell.colorCustom.removeAttribute("aria-invalid");
    });
    this.shell.colorCustom.addEventListener("input", () => {
      const color = this.shell.colorCustom.value.trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) return;
      this.shell.colorCustomPreview.style.backgroundColor = displayInkColor(
        color, this.workspaceRecord?.kind === "notebook",
      );
      this.shell.colorHue.value = String(colorHue(color));
      this.shell.colorCustomError.hidden = true;
      this.shell.colorCustom.removeAttribute("aria-invalid");
    });
    this.shell.colorCustomPanel.addEventListener("submit", (event) => {
      event.preventDefault();
      const color = this.shell.colorCustom.value.trim();
      if (!/^#[0-9a-f]{6}$/i.test(color)) {
        this.shell.colorCustomError.hidden = false;
        this.shell.colorCustom.setAttribute("aria-invalid", "true");
        this.shell.colorCustom.focus();
        this.positionColors();
        return;
      }
      this.setColor(color);
      this.setTool("pen");
      this.closeColors();
      this.shell.colorMenuButton.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Node
        && !this.shell.colorPanel.contains(event.target)
        && !this.shell.colorMenuButton.contains(event.target)) this.closeColors();
      if (event.target instanceof Node
        && !this.shell.templateMenu.contains(event.target)
        && !this.shell.paperTemplate.contains(event.target)) this.closeTemplates();
    });
    this.shell.colorMenuButton.closest(".toolbar")?.addEventListener(
      "scroll", () => {
        this.positionColors();
        this.positionTemplates();
      },
    );
    window.addEventListener("resize", () => {
      this.positionColors();
      this.positionTemplates();
    });
    this.setColor(this.color);
    this.shell.penOnlyMode.addEventListener("change", () => {
      this.penOnly = this.shell.penOnlyMode.checked;
      try {
        localStorage.setItem("calcink:pen-only", String(this.penOnly));
      } catch {
        this.announceStatus("Pen-only mode is active for this session but cannot be saved.");
      }
    });
    this.shell.paperTemplate.addEventListener("click", () => {
      if (!this.shell.templateMenu.hidden) {
        this.closeTemplates();
        return;
      }
      this.closeColors();
      this.shell.templateMenu.hidden = false;
      this.shell.paperTemplate.setAttribute("aria-expanded", "true");
      this.positionTemplates();
      this.shell.templateButtons.find((button) => button.getAttribute("aria-pressed") === "true")?.focus();
    });
    for (const button of this.shell.templateButtons) {
      button.addEventListener("click", () => {
        const page = this.currentSession()?.document;
        const template = button.dataset.template;
        if (!page || !["blank", "ruled", "grid", "dots"].includes(template ?? "")) return;
        if (page.setTemplate(template as "blank" | "ruled" | "grid" | "dots")) {
          this.showTemplate(template!);
          this.saveCurrent();
        }
        this.closeTemplates(true);
      });
    }
    this.shell.moreButton.addEventListener("click", () => {
      if (!this.shell.moreMenu.hidden) {
        this.closeMore(true);
        return;
      }
      this.shell.moreMenu.hidden = false;
      this.shell.moreButton.setAttribute("aria-expanded", "true");
      this.shell.readbackButton.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Node
        && !this.shell.moreMenu.contains(event.target)
        && !this.shell.moreButton.contains(event.target)
        && !this.shell.moreMenu.hidden) this.closeMore(true);
    });
    this.shell.readbackButton.addEventListener("click", () => {
      this.showReadback(true);
    });
    this.shell.closeReadback.addEventListener("click", () => this.showReadback(false));
    this.shell.readbackPanel.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.showReadback(false);
    });
    this.shell.readbackPanel.addEventListener("click", (event) => {
      if (event.target === this.shell.readbackPanel) this.showReadback(false);
    });
    this.shell.revealAnswer.addEventListener("click", () => {
      const edge = this.renderer.rightmostAnswerEdge();
      if (edge === null) return;
      if (this.workspaceRecord?.kind === "whiteboard") {
        this.boardCamera.x = edge
          - (this.shell.workspace.clientWidth - 28) / this.boardCamera.scale;
        this.renderBoardCamera();
        return;
      }
      const target = this.shell.paper.getBoundingClientRect().left
        + edge * (this.isA4() ? this.zoom : 1) + 28;
      this.shell.workspace.scrollBy({
        left: target - this.shell.workspace.getBoundingClientRect().right,
      });
      this.updateAnswerVisibility();
    });
    this.shell.workspace.addEventListener("scroll", () => this.updateAnswerVisibility());
    window.addEventListener("resize", () => this.updateAnswerVisibility());
    this.shell.exportSample.addEventListener("click", () => this.exportSample());
    this.shell.correctionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.correctionGuard || this.busy) return;
      const error = this.equations.applyCorrection(
        this.correctionGuard,
        this.shell.correctionInput.value,
      );
      this.shell.correctionError.hidden = !error;
      this.shell.correctionError.textContent = error ?? "";
      if (error) this.shell.correctionInput.setAttribute("aria-invalid", "true");
      else this.shell.correctionInput.removeAttribute("aria-invalid");
      if (error) {
        if (error.startsWith("The ink changed")) {
          this.correctionGuard = this.selectedLineId
            ? this.equations.guardFor(this.selectedLineId) : null;
          this.correctionSelection = this.correctionGuard
            ? `${this.correctionGuard.lineId}:${this.correctionGuard.canvasRevisionId}` : "";
          const current = this.equations.lines.find(
            (view) => view.line.lineId === this.selectedLineId,
          );
          this.shell.correctionInput.value = displayRead(current?.normalizedRead || current?.rawRead || "");
        }
        this.shell.correctionInput.focus();
      }
      else this.correctionSelection = "";
    });
    this.shell.cancelDelete.addEventListener("click", () => this.shell.deleteDialog.close());
    this.shell.confirmDelete.addEventListener("click", () => void this.deletePage());
    this.shell.retrySave.addEventListener("click", () => {
      this.clearError();
      this.saveQueue?.retry();
    });
    this.shell.retryRecognition.addEventListener("click", () => this.equations.retry());
    this.shell.retryOffline.addEventListener("click", () => {
      void (async () => {
        await this.saveQueue?.flush();
        await this.offline.retryInstall();
      })().catch((error: unknown) => {
        this.showError(`Offline retry failed: ${this.errorMessage(error)}`);
      });
    });
    this.shell.updateButton.addEventListener("click", () => {
      void this.offline.applyUpdate(async () => {
        if (!this.saveQueue) throw new Error("This page is not stored; an update would lose its ink");
        await this.saveQueue.flush();
      }).catch((error: unknown) => {
        this.showError(`Update postponed: ${this.errorMessage(error)}`);
      });
    });
    this.shell.exportRecovery.addEventListener("click", () => this.exportRecovery());
    this.shell.startFresh.addEventListener("click", () => void this.startFresh());
    this.shell.retryStorage.addEventListener("click", () => void this.retryStorage());
    window.addEventListener("keydown", (event) => this.shortcut(event));
  }

  private shortcut(event: KeyboardEvent): void {
    if (event.key === "Escape" && !this.shell.templateMenu.hidden) {
      this.closeTemplates(true);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && !this.shell.colorPanel.hidden) {
      this.closeColors();
      this.shell.colorMenuButton.focus();
      event.preventDefault();
      return;
    }
    const target = event.target;
    if (
      this.shell.pagesDialog.open ||
      this.shell.deleteDialog.open ||
      this.shell.clearDialog.open ||
      this.shell.readbackPanel.open ||
      (target instanceof HTMLElement
        && !!target.closest("input, textarea, select, [contenteditable='true']"))
    ) return;
    if (event.key === "Escape" && !this.shell.moreMenu.hidden) {
      this.closeMore(true);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p"
      && this.workspaceRecord?.kind === "notebook") {
      event.preventDefault();
      this.printCurrentPage();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "p") this.setTool("pen");
    else if (event.key.toLowerCase() === "e") {
      this.setTool(event.shiftKey ? "pixel-eraser" : "stroke-eraser");
    }
  }
}
