# 03. Page Management

Status: Implemented locally in Phase 2 with desktop browser regression tests;
the prototype is reference only.

Owns requirement P-01: a simple local notebook with multiple independent
pages. V1 has no folders, search, sync, sharing, or cross-page calculations.
The page list is navigation; [13. Persistence](13-persistence.md) owns its
IndexedDB implementation and legacy-data migration.

## Data and repository contract

The durable `Page` shape is defined in
[05. Ink Document](05-ink-document.md). IDs are generated with
`crypto.randomUUID()`, and `createdAt`/`updatedAt` are numeric Unix epoch
milliseconds. New pages use `schemaVersion: 2`, title `Untitled page`, and no
strokes. Duplicate titles are allowed; IDs, not titles, identify pages.

```ts
type PageSummary = { id: string; title: string; updatedAt: number };
type SavedPage = {
  page: Page;
  corrections: Record<string, string>;
};

interface PageRepository {
  listPages(): Promise<PageSummary[]>;
  getPage(id: string): Promise<SavedPage | null>;
  savePage(record: SavedPage): Promise<void>;
  deletePage(id: string): Promise<void>;
  getActivePageId(): Promise<string | null>;
  setActivePageId(id: string): Promise<void>;
}
```

`setActivePageId` rejects an ID that has no saved page. The V1 database uses
`pageRecords` keyed by `page.id` and `meta["activePageId"]`. The prototype's
V1 `pages["working-page"]` record remains untouched until a valid V2 copy
and active-page pointer have both been committed. Never replace the original
record with an empty page after a decode or migration error.

## Page controller behavior

1. On startup, let persistence finish any non-destructive migration. Load
   summaries and the active ID. If storage is truly empty, create and save
   one blank page, then select it. An unreadable legacy/V2 record enters
   recovery rather than automatic blank-page creation. If the active ID
   is missing, select the most recently updated valid page, store that
   repaired active ID, and use ID to break `updatedAt` ties.
2. Render the active title and a Pages panel list sorted by descending
   `updatedAt`, with the active page marked in text and semantics. Each row
   offers Switch, Rename, and Delete; `New page` is a separate prominent
   action. Keep the list simple and usable with keyboard or touch.
3. Creating a page saves the new blank record before navigating to it. If
   save fails, keep the current page active and show an error; do not display
   an unsaved new page as if it exists in the notebook.
4. Switching first ends or cancels any pointer gesture, flushes pending
   page/correction writes, and waits for the write to commit. If it fails,
   remain on the current page with its ink visible. Otherwise use the
   target's cached in-memory document if it was visited during this
   session, or load and validate it from the repository. Set the active
   ID, immediately clear old-page projections, and start recognition for
   the target page. Late Worker responses are scoped by page ID and must
   not paint onto the new page.
5. Rename commits when the user presses Enter or leaves the title field.
   Trim surrounding whitespace; an empty title becomes `Untitled page`.
   Limit to 80 characters. Rename updates `updatedAt` and the page list,
   but does not rerun recognition or alter ink history. Escape restores the
   prior title without saving.
6. Delete opens a confirmation naming the page; Escape cancels. The
   repository's `deletePage(id)` transaction deletes the selected V2 record
   and, if it was active, stores a valid replacement active ID. For the
   final page, that same transaction inserts a new blank page **before**
   removing the old one. Only after the transaction commits should the UI
   drop its in-memory history, refresh the list, and display the replacement
   page. If it aborts, keep the old page visible and show an error.
7. Keep one in-memory `InkDocument` per visited page during the session so
   undo/redo on a page survives switching away and back. Histories never
   persist across reload; deleting a page drops its history. Corrections are
   per-page durable data, not part of ink undo.

## Failure rules and invariants

- A page switch never silently discards a pending edit. With unavailable
  storage, the current ephemeral page may be edited, but create/switch/delete
  controls are disabled until saving works; display why.
- A corrupt target record is not treated as an empty page. Keep the current
  page and offer a safe error/retry without modifying the corrupt record;
  Phase 4 adds the recovery export and explicit start-new flow.
- A failed delete transaction leaves the old page and active ID intact.
  Reloading after any unexpected interruption must select a valid page.
- Clear removes strokes on the current page and is undoable. Delete removes
  that page and its corrections after explicit confirmation.

## Tests and done gate

- Unit-test creation, sorting, rename normalization, current/non-current
  deletion, last-page replacement, and per-page history isolation.
- Browser-test writing on A, creating B, writing on B, returning to A,
  reloading, and confirming that each page retains only its own ink and
  correction. Test a late A recognition response after switching to B.
- Fault-inject a rejected save before switch/create and an unreadable target
  record: no blank overwrite, no lost visible ink, and no false success
  status. Verify Escape cancels deletion and keyboard focus returns.
- The gate passes only when a user can create, rename, switch, and delete
  pages repeatedly without cross-page ink/results or data loss.
