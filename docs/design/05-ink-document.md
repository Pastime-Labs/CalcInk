# 05. Ink Document and History

Status: Implemented locally in Phase 2 with unit tests; the prototype is
reference only.

Owns the vector source of truth and editing half of requirement P-02. The
canvas is a projection of this document, never the saved document itself.
The `Page` type is shared with
[03. Page Management](03-page-management.md) and
[13. Persistence](13-persistence.md).

## Durable schema and invariants

```ts
type Point = { x: number; y: number; pressure?: number; t?: number };
type Stroke = { id: string; points: Point[]; width: number };
type Page = {
  schemaVersion: 2;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  strokes: Stroke[];
};
```

Coordinates and width are CSS-pixel world units. Timestamps are numeric Unix
epoch milliseconds for page metadata and page-local elapsed milliseconds
for point `t`; do not confuse the two. New page and stroke IDs use
`crypto.randomUUID()`. A page has unique stroke IDs, finite coordinates,
positive finite widths, nonempty point arrays, valid optional pressure
`[0, 1]`, and finite nonnegative optional times. `createdAt` and
`updatedAt` are finite nonnegative numbers with `updatedAt >= createdAt`.
Loading validates these before constructing an editable document; invalid
stored data is handled by persistence recovery, not silently coerced.

Expose cloned, serializable snapshots so callers cannot mutate document
state through an array reference. Keep command history and redo stacks
outside `Page`; they are in-memory only. Each committed ink operation and
rename updates `updatedAt`, and undo/redo are committed ink changes. A
correction edit also updates the stored page's `updatedAt` through the page
controller, without entering ink history or rerunning recognition. Reading,
rendering, or Worker processing must not change it.

## Document command contract

```ts
class InkDocument {
  constructor(page: Page);
  readonly page: Page;
  readonly strokes: readonly Stroke[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  addStroke(stroke: Stroke): boolean;
  eraseStrokes(path: readonly Point[], radius: number): boolean;
  erasePixels(path: readonly Point[], radius: number): boolean;
  clear(): boolean;
  undo(): boolean;
  redo(): boolean;
  setTitle(title: string): boolean;
  touchUpdatedAt(): void;
}
```

Each `true` ink return value represents one document revision: the page
controller increments its monotonic `canvasRevisionId`, redraws ink,
passes the before/after stroke snapshots to equation orchestration, and
schedules a durable save. Orchestration compares line signatures and
invalidates only affected results; no canvas pixels are inspected. A `false`
no-op does none of those. A title change saves and refreshes navigation
only; it does not increment `canvasRevisionId` or rerecognize ink. Page ID and
revision guard asynchronous answers. Call `touchUpdatedAt()` only after a
valid correction changes; it updates page metadata and schedules a save but
leaves ink history/revision alone. For all timestamp updates, use
`max(Date.now(), previous + 1)` so edits remain ordered even within the
same clock millisecond.

## Editing rules and build sequence

1. Build schema validation and snapshot cloning first. A loaded page must
   retain stroke order, point order, pressure, time, and exact coordinates.
   Never mutate input objects supplied by storage or pointer input.
2. Implement a reversible command record as the removed and inserted
   strokes at their original indexes. A new command clears redo. Undo
   applies its inverse; redo reapplies it. A no-op command is not recorded.
3. Pen completion appends one validated stroke. A one-point stroke renders
   as a dot and remains erasable. Width is captured at pen-down.
4. Whole-stroke eraser intersects the eraser path, treated as a swept circle,
   with each stroke's segments including half its width. Remove every hit
   stroke in **one command**; a tap is a zero-length path segment.
5. Pixel eraser uses the same geometric hit region but removes only covered
   subsegments. Split a hit stroke into surviving fragments with new unique
   IDs and interpolated boundary points, including pressure/time when
   present. Fragments replace the original at its position; erased portions
   must not reappear after redraw or recognition.
6. Clear removes all current strokes as one undoable command. Clearing an
   already blank page is a no-op. Undoing clear restores the same strokes in
   the same order; redo removes them again.
7. Keep separate in-memory histories for visited pages so switching pages
   and back preserves each page's undo/redo during that session. Reload
   starts fresh histories; delete drops the deleted page's history.
8. Validate every edit path and radius before mutation. If an operation
   throws, leave both strokes and history unchanged.

Use an exact vector hit test rather than painting the paper color over a
bitmap. Hidden old ink would otherwise reappear on resize and still reach
the recognizer. The renderer gets a new page snapshot after each commit.

## Tests and done gate

- Unit-test invalid pages/strokes, duplicate IDs, clone isolation, point
  dots, stroke order, no-op commands, redo invalidation, and repeated
  undo/redo cycles.
- Test stroke-eraser contact at endpoints and segment midpoints, including
  a one-point stroke. Test pixel splitting in the middle and at both ends,
  pressure/time interpolation, and complete removal of a tiny fragment.
- Property-test or enumerate erase/undo/redo sequences: replayed snapshots
  equal the original values and never contain duplicate IDs or non-finite
  points. Ensure a saved and reloaded split stroke stays split.
- Verify a title change does not change recognition revision, while each
  committed ink edit does. The gate passes when vector snapshots alone
  fully reconstruct every visible user mark and every command is reversible.
