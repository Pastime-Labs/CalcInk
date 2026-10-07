import type { Point, Stroke } from "./types";

export type Tool = "pen" | "pencil" | "stroke-eraser" | "pixel-eraser" | "lasso";
export type FinishedGesture = {
  tool: Tool;
  width: number;
  points: Point[];
  color?: Stroke["color"];
  style?: Stroke["style"];
};

type ActiveGesture = {
  pointerId: number;
  pointerType: string;
  lastClient: { x: number; y: number };
  tool: Tool;
  width: number;
  color?: Stroke["color"];
  style?: Stroke["style"];
  startStamp: number;
  startTime: number;
  points: Point[];
};

type Pan = {
  pointers: Map<number, { x: number; y: number }>;
  center: { x: number; y: number };
  distance: number;
};

type SurfaceGeometry = {
  bounds: Pick<DOMRect, "left" | "top">;
  scale: number;
};

export function midpoint(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function worldPoint(
  clientX: number,
  clientY: number,
  bounds: Pick<DOMRect, "left" | "top">,
  scale = 1,
): Pick<Point, "x" | "y"> | null {
  const x = (clientX - bounds.left) / scale;
  const y = (clientY - bounds.top) / scale;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

type InputOptions = {
  getColor?: () => Stroke["color"];
  getPenOnly?: () => boolean;
  mapPoint?: (point: Pick<Point, "x" | "y">) => Pick<Point, "x" | "y">;
  onPan?: (dx: number, dy: number) => void;
  onPinch?: (factor: number, center: { x: number; y: number }) => void;
};

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
    private readonly options: InputOptions = {},
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

  private geometry(): SurfaceGeometry {
    const bounds = this.surface.getBoundingClientRect();
    const scale = bounds.width && this.surface.clientWidth
      ? bounds.width / this.surface.clientWidth : 1;
    return { bounds, scale };
  }

  private point(event: PointerEvent, active: ActiveGesture, geometry: SurfaceGeometry): Point | null {
    const local = worldPoint(event.clientX, event.clientY, geometry.bounds, geometry.scale);
    if (!local) return null;
    const position = this.options.mapPoint?.(local) ?? local;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    const t = Math.max(this.lastTime, active.startTime + Math.max(0, event.timeStamp - active.startStamp));
    this.lastTime = t;
    const pressure = event.pointerType === "pen" && Number.isFinite(event.pressure)
      && event.pressure >= 0 && event.pressure <= 1
      ? event.pressure
      : undefined;
    return pressure === undefined ? { ...position, t } : { ...position, pressure, t };
  }

  private append(event: PointerEvent, active: ActiveGesture, geometry = this.geometry()): void {
    const point = this.point(event, active, geometry);
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
        if (positions.length === 2) {
          this.pan.center = midpoint(positions[0], positions[1]);
          this.pan.distance = distance(positions[0], positions[1]);
        }
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
          distance: distance(first, second),
        };
        this.active = null;
        this.surface.setPointerCapture(event.pointerId);
        event.preventDefault();
      }
      return;
    }
    if (event.pointerType === "touch" && this.options.getPenOnly?.()) {
      this.pan = {
        pointers: new Map([[event.pointerId, { x: event.clientX, y: event.clientY }]]),
        center: { x: event.clientX, y: event.clientY },
        distance: 0,
      };
      this.surface.setPointerCapture(event.pointerId);
      event.preventDefault();
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
      color: tool === "pen" || tool === "pencil" ? this.options.getColor?.() : undefined,
      style: tool === "pencil" ? "pencil" : tool === "pen" ? "pen" : undefined,
      startStamp: event.timeStamp,
      startTime: this.lastTime + 1,
      points: [],
    };
    this.append(event, active);
    if (!active.points.length) return;
    this.active = active;
    this.surface.setPointerCapture(event.pointerId);
    this.onDraft({ tool, width, color: active.color, style: active.style, points: active.points });
    event.preventDefault();
  };

  private onMove = (event: PointerEvent): void => {
    if (this.pan) {
      if (!this.pan.pointers.has(event.pointerId)) return;
      this.pan.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const positions = [...this.pan.pointers.values()];
      if (positions.length === 2) {
        const center = midpoint(positions[0], positions[1]);
        this.movePan(center.x - this.pan.center.x, center.y - this.pan.center.y);
        const nextDistance = distance(positions[0], positions[1]);
        if (this.pan.distance > 0 && nextDistance > 0) {
          this.options.onPinch?.(nextDistance / this.pan.distance, center);
        }
        this.pan.distance = nextDistance;
        this.pan.center = center;
      } else if (positions.length === 1 && this.options.getPenOnly?.()) {
        const center = positions[0];
        this.movePan(center.x - this.pan.center.x, center.y - this.pan.center.y);
        this.pan.center = center;
      }
      event.preventDefault();
      return;
    }
    const active = this.active;
    if (!active || event.pointerId !== active.pointerId) return;
    const coalesced = event.getCoalescedEvents?.();
    const geometry = this.geometry();
    for (const sample of coalesced?.length ? coalesced : [event]) this.append(sample, active, geometry);
    // Draft painting reads the live points on its next animation frame.
    this.onDraft({
      tool: active.tool, width: active.width, color: active.color, style: active.style,
      points: active.points,
    });
    event.preventDefault();
  };

  private movePan(dx: number, dy: number): void {
    if (this.options.onPan) {
      this.options.onPan(dx, dy);
    } else {
      this.workspace.scrollLeft -= dx;
      this.workspace.scrollTop -= dy;
    }
  }

  private onUp = (event: PointerEvent): void => {
    if (this.pan) {
      this.releasePanPointer(event.pointerId);
      return;
    }
    const active = this.active;
    if (!active || event.pointerId !== active.pointerId) return;
    this.append(event, active);
    this.active = null;
    this.onDraft(null);
    this.onFinish({
      tool: active.tool, width: active.width, color: active.color, style: active.style,
      points: active.points,
    });
    event.preventDefault();
  };

  private onCancel = (event: PointerEvent): void => {
    if (this.pan) {
      this.releasePanPointer(event.pointerId);
    }
    if (this.active?.pointerId === event.pointerId) this.cancel();
  };

  private releasePanPointer(pointerId: number): void {
    const pan = this.pan;
    if (!pan || !pan.pointers.delete(pointerId)) return;
    if (pan.pointers.size === 0) {
      this.pan = null;
    } else if (pan.pointers.size === 1) {
      pan.center = [...pan.pointers.values()][0];
      pan.distance = 0;
    }
  }
}
