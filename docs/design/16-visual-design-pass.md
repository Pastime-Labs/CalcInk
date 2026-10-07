# 16. Visual Design Pass

Status: **Phase 5A in progress, not accepted**; leader visual approval and
physical-device checks remain open.
This is a product-design checkpoint, not permission to postpone layout,
accessibility, or clear feedback until the end. Its goal is a coherent
handwriting tool, not a generic dashboard or decorative "AI" veneer.

## Design brief

The exact approved visual target is the local Figma Make export in
`Frontend_design_current/src/App.tsx` and
`Frontend_design_current/src/index.css`. It is an untracked reference;
capture approved phone/desktop screenshots and tokens in the outcome
record so the handoff remains reviewable without shipping the export.
The paper is the primary work surface. A user should understand where to
write, which page is open, whether an answer is automatic or corrected, and
whether their ink is saved or usable offline without reading a manual.
Tools should recede until needed, while errors and review affordances remain
unmissable. Desktop and phone share the reference's visual language, not
necessarily the same geometry.

This is a presentation migration to React/Tailwind in the existing root
Vite/PWA app, not a replacement of its tested Canvas, OCR Worker, parser,
IndexedDB, or offline flow. The export's drawing and `localStorage` code
are mock behavior, not implementation to transplant. Its fixed answer,
sample Readback cards, date, and "Recognition ready" label are placeholders,
not product data. A blank page has no answer or Readback line; any displayed
date or status must come from actual state. Its colored-ink picker and other
V2 controls are out of scope. Unlike the export's separate Readback button,
V1 opens Readback from the three-dot menu as a modal, following
[02 Frontend shell](02-frontend-shell.md). Preserve its correction,
sample-export, focus, and status behavior. Compile
Tailwind locally and self-host approved fonts/icons with their notices and
offline precache; do not copy the export's Google Fonts URL. Avoid effects and
animations that compete with drawing responsiveness or shift recognition
input geometry and answer anchors.

The functional shell keeps honest recognition/offline status below the
reference header. At phone widths this strip stays one line so the paper
footer remains reachable. A "View answer" button appears only when a
projected answer lies beyond the visible paper edge; it pans to that answer
without interrupting handwriting when OCR settles. These are deliberate
usability deviations for the leader to review, not mock features.

## Ordered design-to-build process

1. Capture the reference at phone and desktop widths and inventory the
   current app's empty, ink, answer, invalid-read, correction, offline,
   save/model failure, recovery, page, and confirmation states. Map every
   reference control to an existing V1 action or mark it out of scope.
2. Record the reference's surface, type, spacing, color, and icon tokens,
   plus the required deviations: three-dot Readback, no ink-color picker,
   truthful model/save/offline states, and locally bundled fonts. Confirm
   those deviations with the leader before implementation.
3. Integrate React/Tailwind into the root build and migrate one UI region
   at a time. React mounts the structural shell once; the existing
   NotebookApp controller owns state and updates stable shell elements.
   Do not create a parallel notebook, redraw engine, or persistence path.
4. Compare the implemented screens side by side with the approved
   reference at phone and desktop widths. Check long expressions,
   right-edge answers, dense ink, panels, errors, touch targets, contrast,
   focus, screen-reader announcements, and reduced motion. On closing
   Readback, restore focus to the visible three-dot button, not a hidden
   menu item.
5. After each region, run relevant tests. Before approval, repeat the full
   production-build browser/offline flow and active-OCR drawing trace on
   a named device. Upgrade an installed V1 with a pending save to the
   redesigned PWA, reload offline, and verify ink, pages, and corrections.
   Revert a regressing region instead of accepting a visually closer but
   less reliable app.

## Deliverables and exit gate

Keep the approved reference captures, token values, representative
phone/desktop implementation screens, documented deviations, and test
results alongside implementation evidence. No fabricated "model confidence"
badge; automatic results carry an honest review cue.

Exit when the leader approves a consistent visual system, status and
result provenance remain clear at a glance, and the same functional,
accessibility, and performance gates pass after styling. If time is tight,
ship the clean functional UI rather than a polished screen with unverified
recognition or data loss.
