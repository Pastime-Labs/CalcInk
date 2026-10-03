# 02. Frontend Shell

Status: Functional shell implemented locally in Phases 2-4; final device and
accessibility acceptance remains open. The prototype is reference only.

Owns the functional interface for requirement P-09. This is a usability and
accessibility pass, **not** the final visual identity. The later
[visual-design pass](16-visual-design-pass.md) may change typography, color,
and ornament without changing the workflows specified here.

## User-facing structure

- Header: CalcInk identity, current page title, Pages control, save state,
  recognition state, offline state, and Readback control.
- Workspace: scrollable paper, visible ink, inline result layer, an unobtrusive
  first-use hint, and an empty-page state. A user lands here, not on a
  dashboard or blocking onboarding flow.
- Tool area: pen, whole-stroke eraser, pixel eraser, width control, undo,
  redo, and undoable clear. Desktop uses a compact side rail. On narrow
  screens, the same actions live in a bottom dock above the safe area.
- Pages panel: a modal native `<dialog>` with a simple list plus create,
  rename, switch, and delete actions. Style it as an overlay on desktop
  and a safe-area-aware sheet on mobile. The page workflow is defined in
  [03. Page Management](03-page-management.md).
- Readback panel: a non-modal `<aside>` with a DOM representation of the
  selected equation line, recognized text, correction input, validation
  message, and result. It must remain usable even if inline canvas text is
  not readable to assistive technology.

Use semantic `<button>`, `<input>`, `<label>`, `<nav>`, and `<main>`.
The Readback trigger exposes `aria-controls` and `aria-expanded`; its panel
has a visible heading. The drawing surface gets a descriptive accessible
name and instructions; do not misrepresent a pointer-only drawing action
as keyboard-operable. Page and correction forms remain keyboard-operable.

## Interface state

```ts
type Tool = "pen" | "stroke-eraser" | "pixel-eraser";
type SaveState = "loading" | "saved" | "saving" | "not-saved";
type RecognitionState = "loading" | "ready" | "reading" | "unavailable";
type OfflineState = "not-ready" | "ready" | "offline" | "cache-error";
```

The shell displays these as **separate facts**. For example, "Saved on this
device" does not imply recognition is ready, and a browser `offline` event
does not imply the model has been cached. Error and pending states use words
or icons as well as color. Do not show an old result while a changed line is
being reread.

## Interaction specification

1. The first usable screen shows the active page, available tools, and a
   short hint such as `Write 12+3=`. The hint disappears on the first ink
   command and is not written into the page data.
2. Selecting a tool updates its visible selected state and `aria-pressed`.
   Width changes only future pen strokes. Disabled undo/redo/clear buttons
   have native `disabled` state and an understandable label.
3. Clear is a single undoable ink command. It should be labeled as clearing
   the **current page**, not deleting the page. Page deletion has a separate
   named confirmation.
4. Opening Pages or Readback puts focus into that panel. Escape or its close
   control returns focus to the trigger; changing pages closes transient
   panels and cancels an in-progress pointer gesture.
5. Support `P` for pen, `E` for stroke eraser, `Shift+E` for pixel eraser,
   and platform `Ctrl`/`Cmd+Z` and `Ctrl`/`Cmd+Shift+Z` for history. Ignore
   tool shortcuts while an input, textarea, select, editable region, or modal
   panel has focus. Never override browser page-navigation or text-editing
   shortcuts.
6. Give every visible control a text label or accessible name. Keep touch
   targets at least 44 by 44 CSS pixels, visible keyboard focus, logical tab
   order, adequate contrast, and no hover-only essential action. The
   viewport meta tag must not disable browser zoom.
7. At mobile widths, the bottom dock must not cover ink, page navigation,
   Readback actions, or the browser safe area. A long page or many page titles
   must not create horizontal overflow in the shell; paper scrolling is
   separate from shell overflow.
8. Use local assets and a small set of neutral CSS variables now. Do not
   finalize a decorative style, animation system, or brand palette here.
   Respect reduced motion from the start.

## Failure and empty states

| Condition | Visible behavior |
| --- | --- |
| No ink | Quiet hint; undo, redo, and clear disabled. |
| Model loading | Drawing enabled after page load; status says recognition is loading. |
| Recognition unavailable | Drawing and saving stay enabled; Readback explains why no automatic answer is available. |
| Storage unavailable | Persistent "Not saved" warning, with no reassuring saved/offline claim. |
| Page load failure | Keep existing in-memory ink visible; do not switch to an empty page silently. |
| Invalid correction | Keep panel open, focus the input, and show an adjacent message. |

## Build order and acceptance

1. Implement semantic shell markup and basic responsive geometry with
   placeholder state values, then connect actual controller state.
2. Wire tools, width, history and clear; wire the Pages and Readback panels
   after their controllers exist.
3. Connect save, inference, offline, and error states independently; audit
   all labels and focus transitions with keyboard-only navigation.
4. Add browser tests at desktop and phone widths for no clipped controls,
   button state, shortcuts, panel focus, Escape behavior, and 200% text zoom.
   Check a real touch device before release.

Done means every P0 action is discoverable and usable at both widths, and
status text is truthful. It does not mean the final aesthetic pass is done.
