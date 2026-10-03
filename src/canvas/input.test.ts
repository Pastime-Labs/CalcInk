import { afterEach, describe, expect, it, vi } from "vitest";
import { PointerInput, midpoint, worldPoint, type FinishedGesture } from "./input";

afterEach(() => vi.unstubAllGlobals());

describe("worldPoint", () => {
  it("uses CSS pixel coordinates regardless of DPR", () => {
    expect(worldPoint(153, 92, { left: 100, top: 40 })).toEqual({ x: 53, y: 52 });
  });

  it("rejects invalid coordinates", () => {
    expect(worldPoint(Infinity, 2, { left: 0, top: 0 })).toBeNull();
  });
});

describe("midpoint", () => {
  it("uses one coordinate space for both touch pointers", () => {
    expect(midpoint({ x: 120, y: 100 }, { x: 160, y: 140 })).toEqual({ x: 140, y: 120 });
  });
});

function pointerHarness() {
  const listeners = new Map<string, EventListener>();
  const surface = {
    addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLElement;
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const finished: FinishedGesture[] = [];
  const input = new PointerInput(
    surface,
    { scrollLeft: 0, scrollTop: 0 } as HTMLElement,
    () => "pen",
    () => 4,
    () => {},
    (gesture) => finished.push(gesture),
  );
  const fire = (
    name: string,
    pointerId: number,
    pointerType: string,
    x: number,
    isPrimary = true,
  ) => {
    listeners.get(name)?.({
      pointerId,
      pointerType,
      button: 0,
      isPrimary,
      clientX: x,
      clientY: 10,
      timeStamp: x,
      preventDefault: vi.fn(),
    } as unknown as Event);
  };
  return { input, finished, fire };
}

describe("PointerInput", () => {
  it("uses the pointer event when getCoalescedEvents returns no samples", () => {
    const listeners = new Map<string, EventListener>();
    const surface = {
      addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
      setPointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLElement;
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const finished: FinishedGesture[] = [];
    const input = new PointerInput(
      surface,
      { scrollLeft: 0, scrollTop: 0 } as HTMLElement,
      () => "pen",
      () => 4,
      () => {},
      (gesture) => finished.push(gesture),
    );
    const event = (x: number, timeStamp: number) => ({
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      isPrimary: true,
      clientX: x,
      clientY: 10,
      timeStamp,
      preventDefault: vi.fn(),
    });
    listeners.get("pointerdown")?.(event(10, 0) as unknown as Event);
    listeners.get("pointermove")?.({
      ...event(20, 1),
      getCoalescedEvents: () => [],
    } as unknown as Event);
    listeners.get("pointerup")?.(event(30, 2) as unknown as Event);
    expect(finished).toHaveLength(1);
    expect(finished[0].points.map((point) => point.x)).toEqual([10, 20, 30]);
    input.destroy();
  });

  it("keeps finger drawing but gives a later pen priority over a palm touch", () => {
    const { input, finished, fire } = pointerHarness();

    fire("pointerdown", 1, "touch", 10);
    fire("pointerdown", 9, "pen", 15, false);
    fire("pointerup", 1, "touch", 20);
    fire("pointerdown", 2, "touch", 30);
    fire("pointerdown", 3, "pen", 40);
    fire("pointermove", 2, "touch", 50);
    fire("pointermove", 3, "pen", 60);
    fire("pointerup", 3, "pen", 70);
    fire("pointerup", 2, "touch", 80);

    expect(finished.map((gesture) => gesture.points.map((point) => point.x)))
      .toEqual([[10, 20], [40, 60, 70]]);
    input.destroy();
  });

  it("lets a pen replace a two-finger pan without committing touch ink", () => {
    const { input, finished, fire } = pointerHarness();

    fire("pointerdown", 1, "touch", 10);
    fire("pointerdown", 2, "touch", 20);
    fire("pointerdown", 3, "pen", 30);
    fire("pointerup", 1, "touch", 40);
    fire("pointerup", 2, "touch", 50);
    fire("pointerup", 3, "pen", 60);

    expect(finished.map((gesture) => gesture.points.map((point) => point.x)))
      .toEqual([[30, 60]]);
    input.destroy();
  });
});
