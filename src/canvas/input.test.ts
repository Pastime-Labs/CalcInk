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

  it("maps a scaled A4 sheet back into page coordinates", () => {
    expect(worldPoint(220, 140, { left: 20, top: 40 }, 0.5)).toEqual({ x: 400, y: 200 });
  });
});

describe("midpoint", () => {
  it("uses one coordinate space for both touch pointers", () => {
    expect(midpoint({ x: 120, y: 100 }, { x: 160, y: 140 })).toEqual({ x: 140, y: 120 });
  });
});

function pointerHarness(options: ConstructorParameters<typeof PointerInput>[6] = {}) {
  const listeners = new Map<string, EventListener>();
  const surface = {
    addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 320 })),
    clientWidth: 320,
  } as unknown as HTMLElement;
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const finished: FinishedGesture[] = [];
  const drafts: (FinishedGesture | null)[] = [];
  const workspace = { scrollLeft: 0, scrollTop: 0 } as HTMLElement;
  const input = new PointerInput(
    surface,
    workspace,
    () => "pen",
    () => 4,
    (gesture) => drafts.push(gesture),
    (gesture) => finished.push(gesture),
    options,
  );
  const fire = (
    name: string,
    pointerId: number,
    pointerType: string,
    x: number,
    isPrimary = true,
    samples?: number[],
  ) => {
    const event = {
      pointerId,
      pointerType,
      button: 0,
      isPrimary,
      clientX: x,
      clientY: 10,
      timeStamp: x,
      preventDefault: vi.fn(),
    };
    listeners.get(name)?.({
      ...event,
      ...(samples ? {
        getCoalescedEvents: () => samples.map((sample) => ({
          ...event, clientX: sample, timeStamp: sample,
        })),
      } : {}),
    } as unknown as Event);
  };
  return { input, finished, drafts, fire, surface, workspace };
}

describe("PointerInput", () => {
  it("maps coalesced samples once per event and shares the live draft", () => {
    const { input, finished, drafts, fire, surface } = pointerHarness();
    fire("pointerdown", 1, "mouse", 10);
    fire("pointermove", 1, "mouse", 40, true, [20, 30, 40]);
    expect(surface.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(drafts[0]?.points).toBe(drafts[1]?.points);
    expect(drafts[1]?.points.map((point) => point.x)).toEqual([10, 20, 30, 40]);
    fire("pointerup", 1, "mouse", 50);
    expect(finished[0].points.map((point) => point.x)).toEqual([10, 20, 30, 40, 50]);
    input.destroy();
  });

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

  it("stops a two-finger pan when one finger lifts", () => {
    const { input, fire, workspace } = pointerHarness();
    fire("pointerdown", 1, "touch", 10);
    fire("pointerdown", 2, "touch", 110);
    fire("pointermove", 1, "touch", 20);
    expect(workspace.scrollLeft).toBe(-5);
    fire("pointerup", 2, "touch", 110);
    fire("pointermove", 1, "touch", 21);
    expect(workspace.scrollLeft).toBe(-5);
    input.destroy();
  });

  it("maps local drawing points to camera world coordinates", () => {
    const { input, finished, fire } = pointerHarness({
      mapPoint: ({ x, y }) => ({ x: x / 2 + 100, y: y / 2 - 50 }),
    });
    fire("pointerdown", 1, "pen", 20);
    fire("pointerup", 1, "pen", 40);
    expect(finished[0].points.map(({ x, y }) => ({ x, y })))
      .toEqual([{ x: 110, y: -45 }, { x: 120, y: -45 }]);
    input.destroy();
  });

  it("routes touch panning to the camera instead of workspace scroll when supplied", () => {
    const onPan = vi.fn();
    const { input, fire, workspace } = pointerHarness({
      getPenOnly: () => true,
      onPan,
    });
    fire("pointerdown", 1, "touch", 10);
    fire("pointermove", 1, "touch", 25);
    expect(onPan).toHaveBeenCalledWith(15, 0);
    expect(workspace.scrollLeft).toBe(0);
    input.destroy();
  });
});
