# CalcInk Phone Acceptance Runbook

This is an owner-run release gate, not an automated or simulated-mobile
result. Use one named Android phone and Chrome version, and record the exact
CalcInk commit. Keep handwriting exports under ignored `local-assets/`;
they contain private ink and browser details.

## Open the production build

1. Run `npm run build`, then
   `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`.
2. Enable USB debugging on the phone. In desktop Chrome, open
   `chrome://inspect/#devices`, enable USB discovery and port forwarding,
   and forward phone port `4173` to desktop `localhost:4173`. Open
   `http://localhost:4173` in phone Chrome. See
   [Chrome's Android port-forwarding guide](https://developer.chrome.com/docs/devtools/remote-debugging/local-server).
3. Wait for drawing controls to enable. In remote DevTools, confirm the
   hidden `#recognition-status` says `Recognition ready` and `#offline-status`
   says `Ready offline on this device.` Normal status badges are not shown
   in the app. Accept any app update and reload. Export one private
   diagnostic and verify `model.decoder` is `ctc-mask-v2` before starting
   a scored set. Record first-install and first-model-load times separately
   from warm OCR.

## Fresh handwriting and latency

1. Freeze the commit and decoder, then create
   `node scripts/score-benchmark.mjs --template local-assets/benchmark/attempts.json`.
2. Write the [20-expression matrix](RECOGNITION-BENCHMARK.md#2-expression-matrix)
   once in each of three fresh sessions. Clear the page between attempts.
   Export the **first** automatic read before correcting, redrawing,
   switching pages, or reloading. If no first export exists, record a
   specific failure; never substitute a successful Retry or replay.
3. Measure warm final-pen-up to the **visible** settled result for each
   attempt, including slow results. A phone screen recording with frame
   timestamps is preferable to reading the Worker `elapsedMs`, which omits
   UI scheduling. Use `null` when no answer appears. Enter the measurements
   and sample filenames in the private manifest, then run
   `node scripts/score-benchmark.mjs local-assets/benchmark/attempts.json`.
   Retain misses. If code or decoder changes after this set, freeze again
   and collect new handwriting.

## Responsiveness, durability, and access

1. In remote Chrome DevTools, record a **Performance** trace while drawing
   and erasing continuously **during actual OCR inference**. Check the
   Frames and Interactions tracks for missed drawing frames and
   pointer-to-paint delay against the [16.7 ms gate](design/17-quality-and-performance.md).
   Repeat on desktop. A desktop mobile emulator does not prove phone FPS;
   see [Chrome's Performance guide](https://developer.chrome.com/docs/devtools/performance/reference).
2. Repeat equal blocks of draw/erase/undo, OCR, and page switching, then
   observe memory after idle. Record sustained growth rather than inferring
   total memory from JS heap alone. Check touch cancellation, two-finger pan,
   any available stylus/palm behavior, safe areas, and the correction field
   with the software keyboard open.
3. After **Ready offline**, disconnect USB or stop the preview server so
   phone `localhost` cannot silently use desktop port forwarding. Enable
   airplane mode, reload the installed page, draw a new equation, correct
   it, edit the ink, switch pages, and reload again. Reconnect only after
   recording whether the complete flow worked.
4. Check Pages, tools, Readback, correction errors, and status
   announcements with keyboard and any available screen reader. Ink
   authorship remains pointer-only in V1. Record the device/browser,
   observed behavior, trace or screenshot location, and each limitation.

Do not mark Phase 5 passed from this runbook alone. The owner must review
the actual score, trace, memory, offline, accessibility, and visual
evidence, then complete the model redistribution review before a public
release.

## V2-specific checks

On the same physical phone, open the library, create one Notebook and one
Black infinite canvas, return home, then reopen both after reload and
offline. Open the home `+` menu by touch and keyboard; dismiss it with
outside tap and Escape. No folded-corner page control should appear.

In the notebook, add several A4 pages and scroll from first to last as one
continuous book. Select a middle page, write, scroll away and back, and
reload: ink must remain on the correct page. Check that the page fits the
available view after portrait/landscape rotation. Move the 25%-200% page
zoom slider at both ends and check that ink and answers remain aligned;
pinch the page and check that the slider value follows. There should be
no separate Fit Page or 100% buttons. Ink and answer placement must stay
under the pointer after a pinch.
Repeat with browser Ctrl-wheel zoom on desktop. One finger must write without
scrolling. Pinch around ink, then pan with two fingers and release one
finger: the page must not jump or keep moving.
Two-finger vertical book scrolling must not create stray ink.

On the black canvas, draw near the initial view, pan in several directions,
zoom, draw again, and return to the first strokes. The surface must not show
A4 edges, and stored strokes and answers must remain aligned after camera
moves and reload. With Pen-only mode on, a finger must pan without drawing
while a stylus still writes where available. Test all colors, notebook
templates, lasso move/delete/undo, and both workspace kinds after reload.
Use a fresh handwritten board sample before making any board-recognition
accuracy claim; preserved ink and aligned OCR overlays alone do not prove it.
Record frame traces again during active OCR with Pencil and glass controls
visible. On desktop, select a notebook page with a settled answer, then
inspect its real A4 print preview and saved PDF for template, color, ink,
answer, and clipping. Confirm that other notebook pages are absent; do not
infer print quality from the Playwright CSS test alone. Black-canvas PDF
export is not in V2.
