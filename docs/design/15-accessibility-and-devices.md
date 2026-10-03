# 15. Accessibility and Real Devices

Status: **planned V1**. Cross-cutting requirement P-09: apply these checks as
each control and result is built, then run the final device pass. This document
does not claim that handwriting itself can be entered with a keyboard.

## Interaction contract

The page is a drawing surface, but its surrounding app is semantic HTML:
header, main work area, page navigation, labeled tool controls, save/offline
status, and a Readback region. Every tool, page-management action, pen-width
control, correction form, and confirmation can be reached and used with
Tab/Shift+Tab and Enter/Space. Keep visible focus, pressed/selected state in
text or shape as well as color, and a predictable focus destination after a
panel closes or a page is deleted. Shortcuts are optional conveniences, not
the only way to act, and do not fire while typing in a field.

Canvas pixels are not accessible content. Maintain a DOM list of equation
lines with the current automatic raw read when available, current result
or typed error, and whether a result is automatic or user-corrected.
After reload, a restored correction need not have its historical raw
model read; show the correction without inventing that old read. A polite
live region announces a **settled** result or failure for the edited line
once, including the line label and expression. It does not speak on every
pen point or repeat an old answer after a revision. When ink changes, remove
the old DOM result and visual projection together before recognition restarts.
A correction error appears next to the field, is linked to it, and leaves
focus on the invalid input. The Readback panel moves focus inside on open
and restores focus to its opener on close; it must not trap focus if it is
not modal.

The drawing canvas needs a concise accessible name and instructions such as
"Draw an arithmetic expression ending in equals with a finger, stylus, or
mouse; results are listed in Readback." A keyboard user can inspect saved
results, navigate pages, and edit a correction, but cannot originate new ink
in V1. Record this honestly as an accessibility limitation; a separate typed
expression authoring path is a possible later feature, not a hidden V1
requirement.

## Device behavior

- Use Pointer Events and pointer capture for mouse, touch, and stylus. On
  cancellation, discard or consistently finish the draft gesture; never
  leave a half-stroke or a stuck eraser. A simultaneous palm/touch while a pen
  stroke is active must not create stray ink.
- Preserve browser zoom and readable text. Do not disable viewport scaling
  to make canvas gestures easier. Ensure the bottom dock respects phone safe
  areas and the software keyboard does not cover the correction field.
- Touch controls target at least 44 by 44 CSS pixels with enough separation
  to avoid accidental tool changes. No essential action or explanation is
  hover-only. Desktop and mobile may arrange the same controls differently,
  but must not have different capabilities.
- Recompute canvas backing resolution on device-pixel-ratio and viewport
  changes without moving stored world-coordinate strokes or answer anchors.
  Page scrolling and two-finger panning must not erase or draw accidentally.
- Honor reduced-motion preferences for decorative transitions. Status
  changes remain understandable without animation, color, or sound.

## Ordered build

1. Give the functional frontend semantic landmarks, labels, visible focus,
   and stable keyboard order before applying the final visual design.
2. Add the DOM result/readback representation from equation snapshots,
   including automatic/corrected provenance and typed error states. Ensure
   the projection and DOM update from the same revision-checked state.
3. Add explicit focus behavior for tool popovers, Readback, page deletion,
   and recovery dialogs. Keep error/help text programmatically associated
   with its input.
4. Test pointer capture and cancellation on physical devices, then fix
   layout, safe-area, keyboard occlusion, and high-DPR issues found there.
5. Run a separate visual accessibility pass after tokens are chosen; do not
   use a good-looking screenshot as a substitute for keyboard or assistive
   technology checks.

## Tests and exit gate

- Browser-test keyboard-only navigation through all non-drawing controls,
  Readback open/close focus, page deletion focus recovery, correction errors,
  and a live result that changes only after the current revision settles.
- Browser-test 390 px mobile and desktop layouts, high-DPR resize, a touch
  cancellation, and no clipped result or dock control. Simulated mobile
  Chrome is useful but is **not** evidence of physical stylus behavior.
- Witness at least one real phone touch session and the owner's desktop
  mouse session. If a stylus is available, include pressure, palm, and
  cancellation checks; otherwise state "stylus not physically verified".
  Run a keyboard and available screen-reader pass, recording device,
  browser, assistive technology, observed issue, and outcome.

Exit when controls, correction, page navigation, result status, and error
recovery are usable without sight of the answer canvas; the pointer-only
authorship limitation remains explicit.
