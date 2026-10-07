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
3. Wait for **Recognition ready** and **Ready offline on this device**.
   Accept any app update and reload. Export one private diagnostic and
   verify `model.decoder` is `ctc-mask-v1` before starting a scored set.
   Record first-install and first-model-load times separately from warm OCR.

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
