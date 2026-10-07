import { drawStroke } from "../canvas/render";
import { PAGE_HEIGHT, PAGE_WIDTH, type PageSummary, type SavedPage } from "../db";

type Preview = { slot: HTMLElement; wrap: HTMLElement; paper: HTMLElement; canvas: HTMLCanvasElement };

export class NotebookStack {
  private observer: IntersectionObserver | null = null;
  private previews = new Map<string, Preview>();
  private visible = new Set<string>();
  private generation = 0;
  private zoom = 1;

  constructor(
    private readonly stack: HTMLElement,
    private readonly workspace: HTMLElement,
    private readonly editorWrap: HTMLElement,
    private readonly load: (id: string) => Promise<SavedPage | null>,
    private readonly select: (id: string) => void,
    private readonly report: (message: string) => void,
  ) {}

  render(pages: PageSummary[], activeId: string, zoom: number): void {
    this.generation += 1;
    this.observer?.disconnect();
    this.previews.clear();
    this.visible.clear();
    this.zoom = zoom;
    const slots: HTMLElement[] = [];
    for (const [index, summary] of pages.entries()) {
      const slot = document.createElement("section");
      slot.className = "notebook-page";
      slot.dataset.pageId = summary.id;
      slot.dataset.active = String(summary.id === activeId);
      slot.setAttribute("aria-label", `Page ${index + 1}: ${summary.title}`);
      if (summary.id === activeId) {
        slot.append(this.editorWrap);
      } else {
        const wrap = document.createElement("div");
        wrap.className = "paper-wrap a4-page";
        const paper = document.createElement("div");
        paper.className = "paper";
        paper.dataset.template = "ruled";
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        paper.append(canvas);
        wrap.append(paper);
        const action = document.createElement("button");
        action.className = "notebook-preview-action";
        action.type = "button";
        action.setAttribute("aria-label", `Select page ${index + 1} to write`);
        action.addEventListener("click", () => this.select(summary.id));
        slot.append(wrap, action);
        this.previews.set(summary.id, { slot, wrap, paper, canvas });
      }
      slots.push(slot);
    }
    this.stack.replaceChildren(...slots);
    this.setZoom(zoom);
    this.observe();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    for (const preview of this.previews.values()) {
      preview.wrap.style.width = `${PAGE_WIDTH * zoom}px`;
      preview.wrap.style.height = `${PAGE_HEIGHT * zoom}px`;
      preview.paper.style.width = `${PAGE_WIDTH}px`;
      preview.paper.style.height = `${PAGE_HEIGHT}px`;
      preview.paper.style.minWidth = `${PAGE_WIDTH}px`;
      preview.paper.style.minHeight = `${PAGE_HEIGHT}px`;
      preview.paper.style.transform = `scale(${zoom})`;
    }
  }

  reveal(id: string): void {
    this.stack.querySelector<HTMLElement>(`.notebook-page[data-page-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  clear(): void {
    this.generation += 1;
    this.observer?.disconnect();
    this.observer = null;
    this.previews.clear();
    this.visible.clear();
    this.stack.replaceChildren();
  }

  private observe(): void {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.pageId;
        if (!id) continue;
        if (entry.isIntersecting) {
          this.visible.add(id);
          void this.paint(id, this.generation);
        }
        else {
          this.visible.delete(id);
          const canvas = this.previews.get(id)?.canvas;
          if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
          }
        }
      }
    }, { root: this.workspace, rootMargin: "100% 0px" });
    for (const preview of this.previews.values()) this.observer.observe(preview.slot);
  }

  private async paint(id: string, generation: number): Promise<void> {
    const preview = this.previews.get(id);
    if (!preview || preview.canvas.width !== 0) return;
    try {
      const record = await this.load(id);
      if (!record || generation !== this.generation || this.previews.get(id) !== preview
        || !this.visible.has(id)) return;
      preview.paper.dataset.template = record.page.schemaVersion === 3
        ? record.page.template : "ruled";
      const canvas = preview.canvas;
      canvas.width = PAGE_WIDTH;
      canvas.height = PAGE_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) return;
      for (const stroke of record.page.strokes) drawStroke(context, stroke, true);
    } catch (error) {
      this.report(`Page preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
