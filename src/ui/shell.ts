export type Shell = ReturnType<typeof mountShell>;

function element<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing interface element: ${selector}`);
  return found;
}

export function mountShell(root: HTMLElement) {
  root.innerHTML = `
    <div class="app-shell">
      <header class="masthead">
        <div class="identity">
          <span class="identity-mark" aria-hidden="true">C<span>i</span></span>
          <div>
            <p class="eyebrow">An arithmetic notebook</p>
            <strong class="wordmark">CalcInk</strong>
          </div>
        </div>
        <div class="page-heading">
          <span class="page-kicker">Current page</span>
          <h1 id="page-title">Opening notebook...</h1>
        </div>
        <div class="header-actions">
          <button id="pages-button" class="button button-strong" type="button" disabled>Pages <span aria-hidden="true">+</span></button>
          <button id="readback-button" class="button" type="button" aria-controls="readback-panel" aria-expanded="false">Readback</button>
        </div>
      </header>

      <div class="status-bar" aria-label="Notebook status">
        <span id="save-status" class="status-pill" data-tone="muted">Opening local storage</span>
        <span id="recognition-status" class="status-pill" data-tone="muted">Loading recognition</span>
        <span id="offline-status" class="status-pill" data-tone="muted">Preparing offline access</span>
        <button id="retry-save" class="status-action" type="button" hidden>Retry save</button>
        <button id="retry-recognition" class="status-action" type="button" hidden>Retry recognition</button>
        <button id="retry-offline" class="status-action" type="button" hidden>Retry offline install</button>
        <button id="update-button" class="status-action" type="button" hidden>Update app</button>
      </div>
      <div id="error-banner" class="error-banner" role="alert" hidden>
        <span id="error-text"></span>
        <button id="export-recovery" class="button" type="button" hidden>Export original data</button>
        <button id="start-fresh" class="button" type="button" hidden>Start a new page</button>
        <button id="retry-storage" class="button" type="button" hidden>Retry local storage</button>
      </div>

      <main class="notebook">
        <nav class="tools" aria-label="Drawing tools">
          <div class="tool-group">
            <span class="tool-caption">Make</span>
            <button class="tool-button" data-tool="pen" type="button" aria-pressed="true" title="Pen (P)" disabled>
              <span class="tool-glyph" aria-hidden="true">/</span><span>Pen</span>
            </button>
            <button class="tool-button" data-tool="stroke-eraser" type="button" aria-pressed="false" title="Stroke eraser (E)" disabled>
              <span class="tool-glyph" aria-hidden="true">S</span><span>Stroke erase</span>
            </button>
            <button class="tool-button" data-tool="pixel-eraser" type="button" aria-pressed="false" title="Pixel eraser (Shift+E)" disabled>
              <span class="tool-glyph" aria-hidden="true">X</span><span>Pixel erase</span>
            </button>
          </div>
          <div class="tool-group tool-width">
            <label for="pen-width">Pen width <output id="width-value" for="pen-width">4</output></label>
            <input id="pen-width" type="range" min="2" max="12" step="1" value="4" disabled>
          </div>
          <div class="tool-group tool-history">
            <button id="undo-button" class="tool-button" type="button" title="Undo (Ctrl/Command+Z)" disabled><span class="tool-glyph" aria-hidden="true">U</span><span>Undo</span></button>
            <button id="redo-button" class="tool-button" type="button" title="Redo (Ctrl/Command+Shift+Z)" disabled><span class="tool-glyph" aria-hidden="true">R</span><span>Redo</span></button>
            <button id="clear-button" class="tool-button tool-danger" type="button" disabled><span class="tool-glyph" aria-hidden="true">x</span><span>Clear page</span></button>
          </div>
          <p class="tool-note">Ink stays on this device.</p>
        </nav>

        <section class="workspace-frame" aria-label="Notebook workspace">
          <div class="workspace-caption">
            <span>01 / PAPER</span>
            <span>Write an equation, end with <strong>=</strong></span>
          </div>
          <div id="workspace" class="workspace">
            <div id="paper" class="paper">
              <canvas id="ink-canvas" aria-hidden="true"></canvas>
              <canvas id="answer-canvas" aria-hidden="true"></canvas>
              <canvas id="draft-canvas" aria-hidden="true"></canvas>
              <div id="drawing-surface" class="drawing-surface" role="img" aria-label="Writable paper. Use a mouse, pen, or one finger to draw. Use two fingers to pan."></div>
              <p id="empty-hint" class="empty-hint">A little room to think.<br><span>Try writing 12 + 3 =</span></p>
            </div>
          </div>
        </section>

        <aside id="readback-panel" class="readback" aria-labelledby="readback-heading" hidden>
          <div class="panel-heading">
            <div><p class="eyebrow">The model's view</p><h2 id="readback-heading" tabindex="-1">Readback</h2></div>
            <button id="close-readback" class="icon-button" type="button" aria-label="Close Readback">x</button>
          </div>
          <p class="panel-intro">Check what CalcInk read. If a digit is wrong, correct the text here without changing your ink.</p>
          <div id="line-list" class="line-list" aria-label="Equation lines"></div>
          <div id="line-detail" class="line-detail" hidden>
            <p class="detail-label">Raw model read</p>
            <p id="raw-read" class="read-value"></p>
            <p class="detail-label">Interpreted equation</p>
            <p id="normalized-read" class="read-value"></p>
            <p id="line-result" class="result-value"></p>
            <p id="line-message" class="line-message"></p>
            <form id="correction-form">
              <label for="correction-input">Correct the equation</label>
              <input id="correction-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" maxlength="512" placeholder="11+11=">
              <p id="correction-error" class="field-error" role="alert" hidden></p>
              <button class="button button-strong" type="submit">Use correction</button>
            </form>
            <div id="sample-export" class="sample-export" hidden>
              <p>Keep the first model read for local testing. Export includes this line's ink and browser details; nothing is uploaded.</p>
              <button id="export-sample" class="button" type="button">Export sample</button>
            </div>
          </div>
          <p id="readback-empty" class="panel-empty">No ink lines yet. Draw an expression to begin.</p>
        </aside>
      </main>

      <dialog id="pages-dialog" class="pages-dialog" aria-labelledby="pages-heading">
        <div class="panel-heading">
          <div><p class="eyebrow">Local notebook</p><h2 id="pages-heading">Pages</h2></div>
          <button id="close-pages" class="icon-button" type="button" aria-label="Close pages">x</button>
        </div>
        <p class="panel-intro">Pages are stored only in this browser. Clearing site data removes them.</p>
        <button id="new-page" class="button button-strong new-page" type="button">+ New page</button>
        <div id="page-list" class="page-list"></div>
      </dialog>

      <dialog id="delete-dialog" class="confirm-dialog" aria-labelledby="delete-heading">
        <h2 id="delete-heading">Delete this page?</h2>
        <p id="delete-message"></p>
        <div class="dialog-actions">
          <button id="cancel-delete" class="button" type="button">Cancel</button>
          <button id="confirm-delete" class="button button-danger" type="button">Delete page</button>
        </div>
      </dialog>
      <div id="live-region" class="visually-hidden" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;

  return {
    root,
    pageTitle: element<HTMLElement>(root, "#page-title"),
    pagesButton: element<HTMLButtonElement>(root, "#pages-button"),
    readbackButton: element<HTMLButtonElement>(root, "#readback-button"),
    saveStatus: element<HTMLElement>(root, "#save-status"),
    recognitionStatus: element<HTMLElement>(root, "#recognition-status"),
    offlineStatus: element<HTMLElement>(root, "#offline-status"),
    retrySave: element<HTMLButtonElement>(root, "#retry-save"),
    retryRecognition: element<HTMLButtonElement>(root, "#retry-recognition"),
    retryOffline: element<HTMLButtonElement>(root, "#retry-offline"),
    updateButton: element<HTMLButtonElement>(root, "#update-button"),
    errorBanner: element<HTMLElement>(root, "#error-banner"),
    errorText: element<HTMLElement>(root, "#error-text"),
    exportRecovery: element<HTMLButtonElement>(root, "#export-recovery"),
    startFresh: element<HTMLButtonElement>(root, "#start-fresh"),
    retryStorage: element<HTMLButtonElement>(root, "#retry-storage"),
    toolButtons: [...root.querySelectorAll<HTMLButtonElement>("[data-tool]")],
    penWidth: element<HTMLInputElement>(root, "#pen-width"),
    widthValue: element<HTMLOutputElement>(root, "#width-value"),
    undoButton: element<HTMLButtonElement>(root, "#undo-button"),
    redoButton: element<HTMLButtonElement>(root, "#redo-button"),
    clearButton: element<HTMLButtonElement>(root, "#clear-button"),
    workspace: element<HTMLElement>(root, "#workspace"),
    paper: element<HTMLElement>(root, "#paper"),
    inkCanvas: element<HTMLCanvasElement>(root, "#ink-canvas"),
    answerCanvas: element<HTMLCanvasElement>(root, "#answer-canvas"),
    draftCanvas: element<HTMLCanvasElement>(root, "#draft-canvas"),
    drawingSurface: element<HTMLElement>(root, "#drawing-surface"),
    emptyHint: element<HTMLElement>(root, "#empty-hint"),
    readbackPanel: element<HTMLElement>(root, "#readback-panel"),
    readbackHeading: element<HTMLElement>(root, "#readback-heading"),
    closeReadback: element<HTMLButtonElement>(root, "#close-readback"),
    lineList: element<HTMLElement>(root, "#line-list"),
    lineDetail: element<HTMLElement>(root, "#line-detail"),
    rawRead: element<HTMLElement>(root, "#raw-read"),
    normalizedRead: element<HTMLElement>(root, "#normalized-read"),
    lineResult: element<HTMLElement>(root, "#line-result"),
    lineMessage: element<HTMLElement>(root, "#line-message"),
    correctionForm: element<HTMLFormElement>(root, "#correction-form"),
    correctionInput: element<HTMLInputElement>(root, "#correction-input"),
    correctionError: element<HTMLElement>(root, "#correction-error"),
    sampleExport: element<HTMLElement>(root, "#sample-export"),
    exportSample: element<HTMLButtonElement>(root, "#export-sample"),
    readbackEmpty: element<HTMLElement>(root, "#readback-empty"),
    pagesDialog: element<HTMLDialogElement>(root, "#pages-dialog"),
    closePages: element<HTMLButtonElement>(root, "#close-pages"),
    newPage: element<HTMLButtonElement>(root, "#new-page"),
    pageList: element<HTMLElement>(root, "#page-list"),
    deleteDialog: element<HTMLDialogElement>(root, "#delete-dialog"),
    deleteMessage: element<HTMLElement>(root, "#delete-message"),
    cancelDelete: element<HTMLButtonElement>(root, "#cancel-delete"),
    confirmDelete: element<HTMLButtonElement>(root, "#confirm-delete"),
    liveRegion: element<HTMLElement>(root, "#live-region"),
  };
}
