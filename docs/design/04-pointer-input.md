# 04. Pointer Input

Status: Implemented locally in Phase 2; physical touch acceptance remains
open. The prototype is reference only.

Owns the device-to-ink half of requirement P-02. The input adapter converts
mouse, pen, and touch gestures into world-coordinate `Point[]` commands. It
does not recognize handwriting, store pages, or render persistent pixels.
See [05. Ink Document](05-ink-document.md) for commands and
[06. Canvas Rendering](06-canvas-rendering.md) for live preview.

## Input contract

```ts
type Tool = "pen" | "stroke-eraser" | "pixel-eraser";
type Point = { x: number; y: number; pressure?: number; t?: number };

type Gesture =
  | { mode: "idle" }
  | { mode: "pen" | "stroke-eraser" | "pixel-eraser";
      pointerId: number; points: Point[] }
  | { mode: "two-touch-pan"; pointerIds: [number, number] };
```

Only one drawing or erasing pointer is active. The adapter emits one
completed command per gesture and no document command for a canceled or
zero-effect gesture. A pointer change callback tells the composition root
when to save, redraw, and invalidate equation results.

World coordinates are CSS pixels relative to the paper origin:
`x = clientX - paper.getBoundingClientRect().left` and likewise for `y`.
The page can be scrolled; the changing bounding rectangle already accounts
for scroll. Never multiply stored points by `devicePixelRatio`, and do not
remap stored points on resize. V1 has no custom zoom transform. If zoom is
added later, invert its viewport transform at this boundary.

## Event sequence

1. On primary mouse button, pen contact, or first touch `pointerdown`,
   capture that pointer and choose the **current tool for the whole
   gesture**. Record the first point immediately, so a tap produces a dot
   and an eraser tap can hit a dot.
2. On `pointermove`, consume `getCoalescedEvents()` when available, otherwise
   the event itself. Transform every sample to world coordinates, keep
   meaningful movement and corners, and draw a draft preview. Do not
   simplify a `9` or `=` into a different shape merely to reduce points.
3. On `pointerup`, add the final sample if it is not a duplicate. Commit a
   pen stroke or one eraser command, release capture, clear the draft, then
   notify ink/equation/persistence once. A gesture with no hit does not
   create an undo entry or save.
4. On `pointercancel`, lost capture, page switch, or window blur, discard
   the uncommitted gesture and clear the draft. This prevents a half-stroke
   from appearing after an interrupted gesture.
5. Ignore secondary mouse buttons and pointer moves without an active
   gesture. While a pen gesture is active, ignore incidental touch contacts
   instead of treating a palm as a second drawing pointer.
6. With touch input, the first finger draws. If a second finger arrives,
   cancel the uncommitted touch stroke and enter two-touch pan; move the
   scrollable workspace by the change in touch-center position. Do not ink
   while two touches are down. After either finger lifts, require a fresh
   `pointerdown` before drawing again.
7. Use `touch-action: none` on the paper input surface to prevent browser
   panning from stealing a drawing stroke; keep controls and browser zoom
   usable and do not set `user-scalable=no`.

The pen's `pressure` is recorded only when the device supplies a finite
value in `[0, 1]`; mouse and touch use stable base width. A point's `t` is
milliseconds in page-local drawing order. On resuming a saved page, start
new times above its largest saved `t`; clamp subsequent samples to be
nondecreasing even if event timestamps are irregular. Pressure and time are
optional because legacy strokes may lack them.

## Edge and failure behavior

- Freeze pen width and tool at gesture start. A mid-gesture toolbar change
  applies to the next gesture, not partway through the current stroke.
- If the paper resizes or the active page changes mid-gesture, cancel the
  gesture. Pointer capture can outlive the visual bounds, but coordinates
  still derive from the current paper rectangle.
- Ignore non-finite coordinates and impossible event values instead of
  storing corrupt points. A context-menu/right-click should not erase.
- A tiny stationary pen gesture is a one-point dot, not an empty stroke.
  A tap eraser checks the tap location against vector stroke geometry.
- The eraser cursor is a visual aid only. It has no hit-test authority and
  must not cover or intercept controls.

## Tests and done gate

- Unit-test client-to-world conversion under page offsets, vertical and
  horizontal scroll, and device pixel ratios 1 and 2; DPR must not change
  stored coordinates.
- Browser-test mouse, emulated touch, coalesced-event fallback, tap dots,
  final `pointerup` sample, cancel/lost-capture cleanup, and no right-click
  command.
- On a real touch/stylus device, test fast `9`, `11+11=`, slow deliberate
  writing, palm contact, two-finger pan, and switching pages mid-gesture.
  Record device/browser in the evidence.
- The gate passes when each completed physical gesture becomes exactly one
  reversible document command, interrupted gestures make no document
  change, and drawing remains responsive while recognition is busy.
