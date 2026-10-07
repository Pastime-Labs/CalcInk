# 14. Offline App and Model Assets

Status: Service Worker and real offline OCR path implemented locally in Phase 4.
A fresh production browser profile loaded a Paddle Worker and returned a
result after offline reload. A synthetic-ink browser flow covers automatic-read
settlement, correction, edit, page switch, and reload while offline; real
handwriting and physical-phone acceptance remain open. The `htt-mini`
notebook and on-demand Paddle comparison lab are prototype behavior, not
V1 evidence.
An isolated browser regression also rejects the first service-worker
registration once, then verifies that Retry installs the full app and
supports an offline model reload.

## User contract

The first visit needs a network connection to download the static app and
model. Once installation is complete, a user can reload, draw a new equation,
read its automatic result, edit it, and switch local pages without a network.
No expression, stroke, or page is sent to a server. If installation fails,
CalcInk keeps drawing available and says offline use is **not ready**.

The V1 deployment is static HTTPS at the site root. The runtime makes no CDN,
font-host, telemetry, API, or cloud-inference requests. The full install set
includes the HTML entry, hashed JS/CSS chunks, PaddleOCR Worker, both local
PP-OCRv6 tiny detection and recognition model archives, their
vocabulary/configuration, matching JSEP ONNX Runtime WASM files, local fonts,
icons, and manifest. Review the production network log rather than assuming
a file glob matches every emitted asset. Large model archives must be
explicitly included despite cache-size defaults, or the build should fail;
silently omitting one is not acceptable.

## State and update contract

Use the build's service-worker precache for versioned static assets. Keep ink
in IndexedDB, not Cache Storage. The UI has distinct states: downloading
offline assets, ready offline, update available, offline setup failed, and
recognition unavailable. `Ready offline` requires successful installation of
the complete V1 precache, including both Paddle models, JSEP runtime, and
every hashed bundle asset listed in the build-generated `offline-assets.json`.
The list itself must be cached in this app's Workbox precache; a missing chunk
or invalid list prevents a ready claim even if another cache has the file.
Online retry can restore a missing hashed chunk, but a missing revisioned
precache key or entire precache requires a fresh worker install. That repair
uses a temporary worker URL; the next online load may show one update prompt
to return to the normal URL. The prototype lab's on-demand cache
does not meet this V1 readiness contract. If the app is offline
before that point, explain that first installation is incomplete. Do not
confuse `navigator.onLine` with proof that an asset is cached.

Prompt for a new version rather than force-reloading an editing session. If
the user accepts an update, wait for the latest page save to commit, activate
the waiting worker, then reload. An update or failed model load must not
overwrite local pages. If a new model asset cannot be obtained, keep the
current working app where the service-worker strategy permits it and show a
clear failure state; do not claim that recognition works offline.

## Ordered build

1. Inventory the actual production output and every URL requested by a fresh
   online visit and one Paddle detection-plus-recognition inference. Eliminate
   runtime external URLs and verify the precache manifest includes each
   required local file, including both archives and JSEP WASM.
2. Register the service worker without blocking drawing. Surface download,
   ready, failure, and update states in the frontend shell. Ensure the model
   Worker uses stable local asset URLs in both online and offline contexts.
3. Make recognition initialization retryable after transient load failures.
   A failed Worker must not poison the page or display a stale answer.
4. Integrate the update prompt with the persistence save state. Keep the
   current page in memory during an update failure; never activate-and-reload
   over an unsaved edit.
5. Document the first-install requirement and the fact that clearing browser
   site data removes local pages and offline assets. Verify the chosen static
   host serves the app over HTTPS with the expected MIME types.

## Tests and exit gate

- Production-browser test from a fresh browser profile: visit online, wait
  for readiness, write and automatically recognize an equation, go offline,
  close/reopen or reload, write another equation, edit it, verify the new
  result and Readback, switch pages, and reload again. Use the V1 Paddle
  Worker and both models, not the prototype lab or a mocked response.
- Repeat the core flow on the named physical phone in airplane mode after
  the complete initial install. Browser-emulated offline mode alone does
  not establish the brief's zero-connectivity lifecycle claim.
- Test going offline before installation finishes, missing/corrupt model
  fetch, cache quota failure, and an update while a save is pending. Each
  case must show the correct state without lost ink or a false answer.
- Inspect the production network trace during the offline flow; there must
  be no successful reliance on an external request. Check that the public
  hosted build behaves the same as local production preview.

Exit when the complete equation-and-edit flow works after an offline reload
on the named target browser/device and the asset inventory is evidenced.
