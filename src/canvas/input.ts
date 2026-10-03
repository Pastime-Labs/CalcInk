import type { Point } from "./types";

export type Tool = "pen" | "stroke-eraser" | "pixel-eraser";
export type FinishedGesture = { tool: Tool; width: number; points: Point[] };

type ActiveGesture = {
  pointerId: number;
  pointerType: string;
  lastClient: { x: number; y: number };
  tool: Tool;
  width: number;
  startStamp: number;
  startTime: number;
  points: Point[];
};

type Pan = { pointers: Map<number, { x: number; y: number }>; center: { x: number; y: number } };

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function worldPoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top">,
): Pick<Point, "x" | "y"> | null {
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export class PointerInput {
  private active: ActiveGesture | null = null;
  private pan: Pan | null = null;
  private lastTime = 0;

  constructor(
    private readonly surface: HTMLElement,
    private readonly workspace: HTMLElement,
    private readonly getTool: () => Tool,
    private readonly getWidth: () => number,
    private readonly onDraft: (gesture: FinishedGesture | null) => void,
    private readonly onFinish: (gesture: FinishedGesture) => void,
  ) {
    surface.addEventListener("pointerdown", this.onDown);
    surface.addEventListener("pointermove", this.onMove);
    surface.addEventListener("pointerup", this.onUp);
    surface.addEventListener("pointercancel", this.onCancel);
    surface.addEventListener("lostpointercapture", this.onCancel);
    window.addEventListener("blur", this.cancel);
  }

  setTimeFloor(time: number): void {
    if (Number.isFinite(time) && time >= 0) this.lastTime = time;
  }

  cancel = (): void => {
    this.active = null;
    this.pan = null;
    this.onDraft(null);
  };

  destroy(): void {
    this.cancel();
    this.surface.removeEventListener("pointerdown", this.onDown);
    this.surface.removeEventListener("pointermove", this.onMove);
    this.surface.removeEventListener("pointerup", this.onUp);
    this.surface.removeEventListener("pointercancel", this.onCancel);
    this.surface.removeEventListener("lostpointercapture", this.onCancel);
    window.removeEventListener("blur", this.cancel);
  }

  private point(event: PointerEvent, active: ActiveGesture): Point | null {
    const position = worldPoint(event.clientX, event.clientY, this.surface.getBoundingClientRect());
    if (!position) return null;
    const t = Math.max(this.lastTime, active.startTime + Math.max(0, event.timeStamp - active.startStamp));
    this.lastTime = t;
    const pressure = event.pointerType === "pen" && Number.isFinite(event.pressure)
      && event.pressure >= 0 && event.pressure <= 1
      ? event.pressure
      : undefined;
    return pressure === undefined ? { ...position, t } : { ...position, pressure, t };
  }

  private append(event: PointerEvent, active: ActiveGesture): void {
    const point = this.point(event, active);
    if (!point) return;
    active.lastClient = { x: event.clientX, y: event.clientY };
    const previous = active.points.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) active.points.push(point);
  }

  private onDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && (event.button !== 0 || !event.isPrimary)) return;
    if (!event.isPrimary && event.pointerType !== "touch") return;
    if (event.pointerType === "pen") {
      if (this.active?.pointerType === "touch") {
        this.active = null;
        this.onDraft(null);
      }
      this.pan = null;
    }
    if (this.pan) {
      if (event.pointerType === "touch" && this.pan.pointers.size < 2) {
        this.pan.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const positions = [...this.pan.pointers.values()];
        if (positions.length === 2) this.pan.center = midpoint(positions[0], positions[1]);
        this.surface.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
    if (this.active) {
      if (event.pointerType === "touch" && this.active.pointerType === "touch") {
        this.onDraft(null);
        const first = this.active.lastClient;
        const second = { x: event.clientX, y: event.clientY };
        this.pan = {
          pointers: new Map([
            [this.active.pointerId, first],
            [event.pointerId, second],
          ]),
          center: midpoint(first, second),
        };
        this.active = null;
        this.surface.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
    const tool = this.getTool();
    const width = this.getWidth();
    if (!Number.isFinite(width) || width <= 0) return;
    const active: ActiveGesture = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      lastClient: { x: event.clientX, y: event.clientY },
      tool,
      width,
      startStamp: event.timeStamp,
      startTime: this.lastTime + 1,
      points: [],
    };
    this.append(event, active);
    if (!active.points.length) return;
    this.active = active;
    this.surface.setPointerCapture(event.pointerId);
    this.onDraft({ tool, width, points: [...active.points] });
    event.preventDefault();
  };

  private onMove = (event: PointerEvent): void => {
    if (this.pan) {
      if (!this.pan.pointers.has(event.pointerId)) return;
      this.pan.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const positions = [...this.pan.pointers.values()];
      if (positions.length === 2) {
        const center = midpoint(positions[0], positions[1]);
        this.workspace.scrollLeft -= center.x - this.pan.center.x;
        this.workspace.scrollTop -= center.y - this.pan.center.y;
        this.pan.center = center;
      }
      event.preventDefault();
      return;
    }
    const active = this.active;
    if (!active || event.pointerId !== active.pointerId) return;
    const coalesced = event.getCoalescedEvents?.();
    for (const sample of coalesced?.length ? coalesced : [event]) this.append(sample, active);
    this.onDraft({ tool: active.tool, width: active.width, points: [...active.points] });
    event.preventDefault();
  };

  private onUp = (event: PointerEvent): void => {
    if (this.pan) {
      this.pan.pointers.delete(event.pointerId);
      if (this.pan.pointers.size === 0) this.pan = null;
      return;
    }
    const active = this.active;
    if (!active || event.pointerId !== active.pointerId) return;
    this.append(event, active);
    this.active = null;
    this.onDraft(null);
    this.onFinish({ tool: active.tool, width: active.width, points: active.points });
    event.preventDefault();
  };

  private onCancel = (event: PointerEvent): void => {
    if (this.pan) {
      this.pan.pointers.delete(event.pointerId);
      if (this.pan.pointers.size === 0) this.pan = null;
    }
    if (this.active?.pointerId === event.pointerId) this.cancel();
  };
}
