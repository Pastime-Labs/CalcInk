import { InkDocument } from "../canvas/document";
import { PointerInput, type FinishedGesture, type Tool } from "../canvas/input";
import { CanvasRenderer, type AnswerProjection } from "../canvas/render";
import type { Page } from "../canvas/types";
import {
  createPage,
  openPageRepository,
  serializeRecoveryRecord,
  startFreshAfterRecovery,
  StoredDataError,
  type PageRepository,
} from "../db";
import type { EquationResult } from "../parser";
import { registerOfflineApp, type OfflineController, type OfflineStatus } from "../pwa";
import { EquationController, type CorrectionGuard, type LineView } from "./equations";
import { SaveQueue, type SaveStatus } from "./save-queue";
import { mountShell, type Shell } from "./shell";

type Session = { document: InkDocument; corrections: Record<string, string> };

function resultText(result: EquationResult | null): string {
  if (!result) return "";
  if (result.kind === "value") return result.display;
  return result.kind === "undefined" ? "Undefined" : "Check expression";
}

function lineStatus(view: LineView): string {
  if (view.phase === "complete") return view.source === "corrected" ? "Corrected" : "Review read";
  if (view.phase === "incomplete") return "Finish with =";
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

export class NotebookApp {
  private readonly shell: Shell;
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

  constructor(root: HTMLElement) {
    this.shell = mountShell(root);
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
      () => this.tool === "pen" ? Number(this.shell.penWidth.value)
        : this.tool === "stroke-eraser" ? 13 : 9,
      (draft) => this.renderer.setDraft(draft),
      (gesture) => this.finishGesture(gesture),
    );
    this.bindControls();
    this.offline = registerOfflineApp((status) => this.renderOffline(status));
    window.addEventListener("online", () => this.renderOffline(this.offline.current()));
    window.addEventListener("offline", () => this.renderOffline(this.offline.current()));
    window.addEventListener("beforeunload", (event) => {
      if (this.saveQueue?.hasUnsavedChanges()
        || (!this.saveQueue && !!this.currentSession()?.document.strokes.length)) {
        event.preventDefault();
      }
    });
  }

  async start(): Promise<void> {
    try {
      this.repository = await openPageRepository();
      let activeId = await this.repository.getActivePageId();
      if (!activeId) {
        const page = createPage();
        await this.repository.savePage({ page, corrections: {} });
        await this.repository.setActivePageId(page.id);
        activeId = page.id;
      }
      await this.activatePage(activeId);
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
    this.renderer.setInk([]);
    this.renderer.setAnswers([]);
    this.shell.liveRegion.textContent = "";
    this.equations.setPage(page, {});
    this.shell.pageTitle.textContent = page.title;
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
      this.renderer.setInk(session.document.strokes);
      this.input.setTimeFloor(this.latestPointTime(session.document.page));
      this.selectedLineId = null;
      this.correctionGuard = null;
      this.correctionSelection = "";
      this.shell.liveRegion.textContent = "";
      this.equations.setPage(session.document.page, session.corrections);
      this.shell.workspace.scrollTo({ top: 0, left: 0 });
      this.updateControls();
      this.clearError();
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
    this.shell.offlineStatus.dataset.tone = status.kind === "ready" ? "ok"
      : status.kind === "failed" || status.kind === "unavailable" ? "error" : "warning";
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
    this.shell.pagesButton.disabled = this.busy || !this.repository;
    this.shell.emptyHint.hidden = !document || document.strokes.length > 0;
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.updateControls();
  }

  private finishGesture(gesture: FinishedGesture): void {
    if (this.busy) return;
    const document = this.currentSession()?.document;
    if (!document) return;
    let changed: boolean;
    try {
      if (gesture.tool === "pen") {
        changed = document.addStroke({
          id: crypto.randomUUID(),
          width: gesture.width,
          points: gesture.points,
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
        text: resultText(view.result),
        source: view.source ?? "automatic",
      }];
    });
    this.conflicts = this.renderer.setAnswers(projections);
    this.renderReadback();
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
    const selectionKey = `${selected.line.lineId}:${this.equations.canvasRevisionId}`;
    if (selectionKey !== this.correctionSelection) {
      const editingOldRead = document.activeElement === this.shell.correctionInput
        && this.shell.correctionInput.value.trim().length > 0
        && this.correctionGuard?.lineId === selected.line.lineId;
      if (!editingOldRead) {
        this.correctionSelection = selectionKey;
        this.correctionGuard = this.equations.guardFor(selected.line.lineId);
        this.shell.correctionInput.value = selected.normalizedRead || selected.rawRead;
        this.shell.correctionError.hidden = true;
        this.shell.correctionInput.removeAttribute("aria-invalid");
      }
    } else if (!this.shell.correctionInput.value && selected.normalizedRead) {
      this.shell.correctionInput.value = selected.normalizedRead;
    }
    this.shell.rawRead.textContent = selected.rawRead || "Not read yet";
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
        : selected.message,
      reason,
    ].filter(Boolean).join(" ");
    const announcements: string[] = [];
    views.forEach((view, index) => {
      const key = `${pagePrefix}${view.line.lineId}`;
      if (view.phase === "queued" || view.phase === "reading") {
        this.announcedResults.delete(key);
        return;
      }
      const expression = view.normalizedRead || view.rawRead || "unreadable ink";
      const outcome = view.phase === "complete"
        ? `${resultText(view.result)}. ${lineStatus(view)}.`
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
    this.shell.readbackPanel.hidden = !open;
    this.shell.readbackButton.setAttribute("aria-expanded", String(open));
    if (open) this.shell.readbackHeading.focus();
    else this.shell.readbackButton.focus();
  }

  private async refreshPages(): Promise<void> {
    if (!this.repository) return;
    const summaries = await this.repository.listPages();
    this.shell.pageList.replaceChildren();
    for (const summary of summaries) {
      const row = document.createElement("div");
      row.className = "page-row";
      row.dataset.active = String(summary.id === this.activeId);
      const switchButton = button("", "page-switch");
      const title = document.createElement("strong");
      title.textContent = summary.title;
      const subtitle = document.createElement("small");
      subtitle.textContent = summary.id === this.activeId ? "Current page" : "Open page";
      switchButton.append(title, subtitle);
      switchButton.addEventListener("click", () => void this.switchPage(summary.id));
      const rename = button("Rename", "button");
      rename.addEventListener("click", () => this.beginRename(row, summary.id, summary.title));
      const remove = button("Delete", "button");
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

  private async switchPage(id: string): Promise<void> {
    if (this.busy || id === this.activeId) {
      if (id === this.activeId) this.shell.pagesDialog.close();
      return;
    }
    this.setBusy(true);
    try {
      await this.activatePage(id);
    } catch (error) {
      this.showError(`Page not switched: ${this.errorMessage(error)}`);
    } finally {
      this.setBusy(false);
    }
  }

  private async addPage(): Promise<void> {
    if (this.busy || !this.repository) return;
    this.setBusy(true);
    this.shell.newPage.disabled = true;
    try {
      await this.saveQueue?.flush();
      const page = createPage();
      await this.repository.savePage({ page, corrections: {} });
      await this.activatePage(page.id);
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
    const intended = window.prompt("Enter the equation you actually wrote, ending with =.");
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
      this.repository = candidate;
      if (!await this.activatePage(active)) throw new Error("Could not open the new page");
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
      await candidate.savePage(snapshot);
      await candidate.setActivePageId(session.document.page.id);
      this.repository = candidate;
      if (!await this.activatePage(session.document.page.id)) {
        throw new Error("Could not open the recovered page");
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

  private bindControls(): void {
    for (const control of this.shell.toolButtons) {
      control.addEventListener("click", () => this.setTool(control.dataset.tool as Tool));
    }
    this.shell.penWidth.addEventListener("input", () => {
      this.shell.widthValue.value = this.shell.penWidth.value;
    });
    this.shell.undoButton.addEventListener("click", () => this.undo());
    this.shell.redoButton.addEventListener("click", () => this.redo());
    this.shell.clearButton.addEventListener("click", () => {
      if (this.busy) return;
      if (this.currentSession()?.document.clear()) this.inkChanged();
    });
    this.shell.pagesButton.addEventListener("click", () => {
      this.input.cancel();
      void this.refreshPages().then(() => this.shell.pagesDialog.showModal())
        .catch((error: unknown) => this.showError(this.errorMessage(error)));
    });
    this.shell.closePages.addEventListener("click", () => this.shell.pagesDialog.close());
    this.shell.pagesDialog.addEventListener("close", () => this.shell.pagesButton.focus());
    this.shell.newPage.addEventListener("click", () => void this.addPage());
    this.shell.readbackButton.addEventListener("click", () => {
      this.showReadback(this.shell.readbackPanel.hidden === true);
    });
    this.shell.closeReadback.addEventListener("click", () => this.showReadback(false));
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
          this.shell.correctionInput.value = current?.normalizedRead || current?.rawRead || "";
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
      void this.offline.retryInstall().catch((error: unknown) => {
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
    const target = event.target;
    if (
      this.shell.pagesDialog.open ||
      this.shell.deleteDialog.open ||
      (target instanceof HTMLElement
        && !!target.closest("input, textarea, select, [contenteditable='true']"))
    ) return;
    if (event.key === "Escape" && !this.shell.readbackPanel.hidden) {
      this.showReadback(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "p") this.setTool("pen");
    else if (event.key.toLowerCase() === "e") {
      this.setTool(event.shiftKey ? "pixel-eraser" : "stroke-eraser");
    }
  }
}
