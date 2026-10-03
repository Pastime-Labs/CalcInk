# 13. Persistence and Recovery

Status: Core repository and UI recovery implemented locally in Phases 2 and 4
with migration and write-ordering tests. Simulated quota failure, aborted
transaction rollback, and blocked upgrade have unit tests; actual browser
quota/multi-tab faults and browser-seeded corrupt-record recovery remain
open. The archived prototype stores one flat `schemaVersion: 1` page at
IndexedDB `calcink/pages["working-page"]`, with a 450 ms save debounce. That record is
user data, not disposable seed data.

## Purpose and boundaries

Save local pages, titles, vector ink, and per-page Readback corrections without
a server. A page switch, refresh, offline reload, or normal tab close must not
silently replace the last committed edit with an older snapshot. The UI must
distinguish "saving" from a completed IndexedDB transaction. Undo history and
transient recognition answers are not stored; answers are recomputed from ink
and restored corrections after load. Clearing browser site data still deletes
local pages, so the UI and release notes must say so.

## Data and repository contract

```ts
type Page = {
  schemaVersion: 2;
  id: string;
  title: string;
  createdAt: number; // Unix epoch milliseconds
  updatedAt: number; // Unix epoch milliseconds
  strokes: Stroke[];
};
type PageSummary = { id: string; title: string; updatedAt: number };
type SavedPage = { page: Page; corrections: Record<string, string> };

listPages(): Promise<PageSummary[]>;
getPage(id: string): Promise<SavedPage | null>;
savePage(record: SavedPage): Promise<void>;
deletePage(id: string): Promise<void>;
getActivePageId(): Promise<string | null>;
setActivePageId(id: string): Promise<void>;
```

The repository is the only caller of IndexedDB. Open database `calcink` at
version 2. Keep the legacy `pages` store untouched; put v2 wrappers in a new
`pageRecords` store under their `page.id`, and store `activePageId` in a new
`meta` store. A transaction reports success only on `transaction.oncomplete`,
not after `put()` is queued. `setActivePageId` rejects a missing page. Sort
summaries by `updatedAt` descending, then ID for a stable tie. A new page gets
a UUID and timestamps at creation; a successful edit updates `updatedAt`.
Rename, ink changes, erasures, clear, and correction changes all count as
edits. Page selection alone does not.

Validate untrusted stored records before making them the live document: v2
marker, nonempty ID/title, finite nonnegative timestamps with
`updatedAt >= createdAt`, nonempty stroke point arrays, finite point coordinates, positive
finite stroke widths, pressure in `[0, 1]` when present, finite nonnegative
point times, unique stroke IDs, and a string-to-string corrections map.
Reject unsupported future versions instead of guessing how to read them.
Bound absurdly large records before rendering or feeding the model.
Render saved titles and correction text as text, never HTML. Validation must
not modify the stored value.

## Ordered build

Phase 2 establishes safe, committed pages before page-management is called
done; Phase 4 completes recovery and write hardening.

1. In Phase 2, add the v2 repository and a small validator with unit tests.
   Handle `onblocked` and `onversionchange`: close this tab's old connection when
   requested; if an older tab blocks the upgrade, show "Close other CalcInk
   tabs to finish updating" instead of clearing the database.
2. On startup, read the v2 active page. If the active ID is missing or points
   to a deleted record, select the most recently updated valid v2 page. If
   there are no v2 pages, inspect the legacy `working-page` record.
3. For a valid legacy page, convert it to a **new UUID** v2 page. Set
   `createdAt` and `updatedAt` to migration time, preserve stroke IDs, point
   order, title, and valid correction strings, then write the v2 copy and
   active ID in one read-write transaction. Leave the original legacy record
   untouched. On the next launch, use the v2 copy; never migrate it twice.
4. In Phase 2, wire page create/rename/switch/delete through the repository
   with serialized, committed saves; await the current page's save before
   switching away. Never report "Saved" before `transaction.oncomplete`.
   A failed write keeps the current ink visible and shows "Not saved".
   Deleting the active page chooses another existing page in the same
   transaction as the deletion and active-ID update. For the last page,
   insert its replacement before deleting the old one in that transaction;
   an aborted transaction retains the old page. Require confirmation before
   deletion. Phase 3 stores corrections with their page and invalidates only
   the affected line after an ink edit.
5. In Phase 4, complete malformed/future-record recovery without overwriting
   or deleting the source. Show retry, a download of the original record when
   it can be serialized as JSON, and an explicit "Start a new page" action
   that uses a new ID. If serialization fails, leave the record untouched and
   explain that recovery export is unavailable. Never load corrupt strokes
   into recognition. A page that cannot be saved remains usable in memory
   with a persistent "Not saved" warning.
6. In Phase 4, harden immediate persistence for every completed ink command,
   title edit, and correction with a single-writer queue that coalesces only
   snapshots not yet started. Never allow an older async completion to mark a
   newer dirty revision as saved. Keep a visible pending state until commit.
   While unsaved, warn on desktop unload where supported. On visibility
   change, request a flush as a best effort, not as the only save mechanism.

## Failure policy

- Quota, private-mode, permission, and transaction errors leave the current
  in-memory page intact, show "Not saved", and offer retry; they never display
  "Saved on this device".
- A browser or OS killed before an IndexedDB transaction commits cannot be
  guaranteed to preserve that edit. The UI may claim durability only after
  the commit; immediate-reload tests should be run from the completed gesture
  and must expose any loss rather than rely on a timer.
- V1 supports one active editing tab. Do not claim conflict-free simultaneous
  edits in two tabs; record this limitation in release notes if unresolved.
- No automatic recovery action may erase the original malformed or legacy
  record. A user-initiated delete targets only the selected v2 page.

## Tests and exit gate

- Unit-test validation, stable summary ordering, migration mapping, and
  save-revision ordering. Inject failed, aborted, blocked, and quota-limited
  transactions.
- Browser-test a seeded v1 record: migrate once, preserve ink/title/correction,
  reload twice, and confirm the original `pages["working-page"]` bytes still
  exist. Seed corrupt and future-version records and verify a non-destructive
  recovery screen.
- Browser-test create, rename, switch, delete, last-page replacement, and
  per-page correction isolation. Draw/erase/undo, immediately reload and
  reopen after "Saved on this device", then compare exact stroke IDs and
  coordinates. Also test immediate reload before commit and verify the status
  never falsely reports a successful save.

Exit only when every edit **acknowledged as saved** survives reload and page
switching, no corrupt input is silently overwritten, and storage failure
or a still-pending save is visible. An OS kill before transaction commit
remains a documented browser limitation, not a false success.
