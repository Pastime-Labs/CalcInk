import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const toolImages = {
  pen: new URL("../../ICONS/pen-tool.png", import.meta.url).href,
  pencil: new URL("../../ICONS/pencil.png", import.meta.url).href,
  eraser: new URL("../../ICONS/eraser_stroke.png", import.meta.url).href,
  template: new URL("../../ICONS/background.png", import.meta.url).href,
};

type IconName = "pages" | "pen" | "eraser" | "pixels" | "undo" | "redo" | "trash" | "plus" | "more" | "close" | "chevron-left" | "chevron-right" | "lasso" | "print";

function Icon({ name }: { name: IconName }) {
  const paths = {
    pages: <><path d="M8 6.5h10M8 10.5h7M8 14.5h8" /><path d="M5 3.5h16v17H5z" /></>,
    pen: <><path d="m5 19 3.5-.8L19 7.7 15.3 4 4.8 14.5 4 18z" /><path d="m13.8 5.5 3.7 3.7" /></>,
    eraser: <><path d="m4 15 8.5-9a2 2 0 0 1 2.8-.1l2.8 2.7a2 2 0 0 1 0 2.8L10.8 19H7z" /><path d="m10 10 5 5M10.8 19H20" /></>,
    pixels: <><path d="m4.5 15 8-9a2 2 0 0 1 2.9-.1l2.7 2.7a2 2 0 0 1 0 2.8L11 19H7z" /><path d="m10 10 5 5" /><path d="M16.5 17.5h3M18 16v3" /></>,
    undo: <><path d="M9 8 5 12l4 4" /><path d="M6 12h7.5a5 5 0 0 1 5 5" /></>,
    redo: <><path d="m15 8 4 4-4 4" /><path d="M18 12h-7.5a5 5 0 0 0-5 5" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6.5 7l.8 14h9.4l.8-14" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    close: <path d="m7 7 10 10M17 7 7 17" />,
    "chevron-left": <path d="m15 5-7 7 7 7" />,
    "chevron-right": <path d="m9 5 7 7-7 7" />,
    lasso: <><path d="M19 10c0 4-3.4 7-8 7-4.2 0-7-2.3-7-5s2.8-5 7-5c3.6 0 6.4 1.4 7.5 3.5" /><path d="M19 10c1.4 1.8 1.8 4.4.4 6.1-.8.9-2.2 1-3.1.2" /></>,
    print: <><path d="M7 8V3h10v5M7 18H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v7H7zM17 11h.01" /></>,
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function ToolImage({ name }: { name: keyof typeof toolImages }) {
  return <img className="tool-image" src={toolImages[name]} alt="" aria-hidden="true" />;
}

function ShellView() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="header-primary">
          <div className="header-left">
            <button id="home-button" aria-label="Back to library" className="header-icon-button" type="button"><Icon name="chevron-left" /></button>
            <button id="pages-button" aria-label="Pages" className="header-icon-button" type="button" disabled>
              <Icon name="pages" />
            </button>
          </div>
          <div className="document-title">
            <h1 id="page-title">Opening notebook...</h1>
            <span id="save-status" className="status-pill" data-tone="muted">Opening local storage</span>
          </div>
          <div className="header-actions">
            <button id="undo-button" aria-label="Undo" className="header-icon-button" title="Undo (Ctrl/Command+Z)" type="button" disabled><Icon name="undo" /></button>
            <button id="redo-button" aria-label="Redo" className="header-icon-button" title="Redo (Ctrl/Command+Shift+Z)" type="button" disabled><Icon name="redo" /></button>
            <button id="clear-button" aria-label="Clear page" className="header-icon-button" type="button" disabled><Icon name="trash" /></button>
            <button id="quick-new-page" aria-label="Add notebook page" className="header-icon-button" type="button" disabled><Icon name="plus" /></button>
            <button id="more-button" aria-label="More options" aria-controls="more-menu" aria-expanded="false" className="header-icon-button" type="button"><Icon name="more" /></button>
            <div id="more-menu" className="more-menu" hidden>
              <button id="readback-button" aria-controls="readback-panel" aria-expanded="false" type="button">Readback</button>
              <button id="clear-menu-button" className="mobile-menu-only" type="button" disabled><Icon name="trash" /> Clear page</button>
              <button id="print-page" type="button" disabled><Icon name="print" /> Print page / Save PDF</button>
              <label className="menu-toggle" htmlFor="pen-only-mode">
                <span>Pen-only mode<small>Only a stylus writes; fingers move the page</small></span>
                <input id="pen-only-mode" type="checkbox" />
              </label>
            </div>
          </div>
        </div>
      </header>

      <div className="status-strip" aria-label="Workspace status">
        <span id="recognition-status" className="status-pill" data-tone="muted">Loading recognition</span>
        <span id="offline-status" className="status-pill" data-tone="muted">Preparing offline access</span>
        <button id="retry-save" className="status-action" type="button" hidden>Retry save</button>
        <button id="retry-recognition" className="status-action" type="button" hidden>Retry recognition</button>
        <button id="retry-offline" className="status-action" type="button" hidden>Retry offline install</button>
        <button id="update-button" className="status-action" type="button" hidden>Update app</button>
      </div>
      <button id="reveal-answer" className="reveal-answer" type="button" hidden>View answer →</button>
      <div id="error-banner" className="error-banner" role="alert" hidden>
        <span id="error-text"></span>
        <button id="export-recovery" className="button" type="button" hidden>Export original data</button>
        <button id="start-fresh" className="button" type="button" hidden>Start a new page</button>
        <button id="retry-storage" className="button" type="button" hidden>Retry local storage</button>
      </div>

      <main id="workspace" className="workspace" aria-label="Drawing workspace">
        <div className="page-nav" aria-label="Page controls">
          <div className="page-stepper">
            <button id="prev-page" className="page-nav-button" aria-label="Previous page" type="button" disabled><Icon name="chevron-left" /></button>
            <span id="page-position" className="page-position" aria-live="polite">Page 1 of 1</span>
            <button id="next-page" className="page-nav-button" aria-label="Next page" type="button" disabled><Icon name="chevron-right" /></button>
          </div>
          <div className="zoom-control">
            <input id="zoom-slider" aria-label="Page zoom" type="range" min="25" max="200" step="1" defaultValue="100" disabled />
            <output id="zoom-value" htmlFor="zoom-slider">100%</output>
          </div>
        </div>
        <div id="notebook-stack" className="notebook-stack">
          <section className="notebook-page" data-active="true">
            <div className="paper-wrap">
              <div id="paper" className="paper">
                <canvas id="ink-canvas" aria-hidden="true"></canvas>
                <canvas id="answer-canvas" aria-hidden="true"></canvas>
                <canvas id="draft-canvas" aria-hidden="true"></canvas>
                <div id="drawing-surface" className="drawing-surface" role="img" aria-label="Writable paper. Use a mouse, pen, or one finger to draw. Use two fingers to pan." />
              </div>
            </div>
          </section>
        </div>
      </main>

      <nav className="bottom-toolbar" aria-label="Drawing controls">
        <div className="toolbar" role="toolbar">
          <div className="tool-section" aria-label="Drawing tools">
            <button className="tool-button" data-tool="pen" aria-label="Pen" aria-pressed="true" title="Pen (P)" type="button" disabled><ToolImage name="pen" /><span>Pen</span></button>
            <button id="pencil-tool" className="tool-button" data-tool="pencil" aria-label="Pencil" aria-pressed="false" title="Pencil" type="button" disabled><ToolImage name="pencil" /><span>Pencil</span></button>
            <button className="tool-button" data-tool="stroke-eraser" aria-label="Stroke eraser" aria-pressed="false" title="Stroke eraser (E)" type="button" disabled><ToolImage name="eraser" /><span>Stroke eraser</span></button>
            <button className="tool-button" data-tool="pixel-eraser" aria-label="Pixel eraser" aria-pressed="false" title="Pixel eraser (Shift+E)" type="button" disabled><Icon name="pixels" /><span>Pixel eraser</span></button>
            <button id="lasso-tool" className="tool-button" data-tool="lasso" aria-label="Lasso select" aria-pressed="false" title="Lasso select" type="button" disabled><Icon name="lasso" /><span>Lasso</span></button>
            <div className="width-control">
              <span id="width-dot" className="width-dot" aria-hidden="true" />
              <label className="sr-only" htmlFor="pen-width">Pen width</label>
              <input id="pen-width" aria-label="Pen width" type="range" min="2" max="12" step="1" defaultValue="4" disabled />
              <output id="width-value" className="sr-only" htmlFor="pen-width">4</output>
            </div>
            <div className="color-section">
              <button id="color-menu-button" className="color-trigger" aria-label="Choose ink color" aria-controls="color-panel" aria-expanded="false" title="Ink color" type="button" disabled>
                <span className="current-color" aria-hidden="true"></span><Icon name="chevron-right" />
              </button>
            </div>
            <div className="template-control">
              <button id="paper-template" className="template-trigger" type="button" aria-label="Paper template: Ruled" aria-controls="template-menu" aria-expanded="false" disabled>
                <ToolImage name="template" /><span id="paper-template-label">Ruled</span><Icon name="chevron-right" />
              </button>
            </div>
          </div>
        </div>
      </nav>
      <div id="color-panel" className="color-panel color-picker-popover" role="group" aria-label="Ink colors" hidden>
        <span className="color-picker-label">Ink color</span>
        <div className="color-swatches" role="group" aria-label="Preset colors">
          <button id="color-black" className="color-swatch" data-color="#121619" style={{ "--swatch": "#121619" } as React.CSSProperties} aria-label="Use Black ink" aria-pressed="true" title="Black" type="button"></button>
          <button id="color-gray" className="color-swatch" data-color="#84898c" style={{ "--swatch": "#84898c" } as React.CSSProperties} aria-label="Use Gray ink" aria-pressed="false" title="Gray" type="button"></button>
          <button id="color-light-gray" className="color-swatch" data-color="#d9ddde" style={{ "--swatch": "#d9ddde" } as React.CSSProperties} aria-label="Use Light gray ink" aria-pressed="false" title="Light gray" type="button"></button>
          <button id="color-white" className="color-swatch" data-color="#ffffff" style={{ "--swatch": "#ffffff" } as React.CSSProperties} aria-label="Use White ink" aria-pressed="false" title="White" type="button"></button>
          <button id="color-blue" className="color-swatch" data-color="#2186df" style={{ "--swatch": "#2186df" } as React.CSSProperties} aria-label="Use Blue ink" aria-pressed="false" title="Blue" type="button"></button>
          <button id="color-red" className="color-swatch" data-color="#ed3152" style={{ "--swatch": "#ed3152" } as React.CSSProperties} aria-label="Use Red ink" aria-pressed="false" title="Red" type="button"></button>
          <button id="color-green" className="color-swatch" data-color="#2fc477" style={{ "--swatch": "#2fc477" } as React.CSSProperties} aria-label="Use Green ink" aria-pressed="false" title="Green" type="button"></button>
          <button id="color-yellow" className="color-swatch" data-color="#f2c638" style={{ "--swatch": "#f2c638" } as React.CSSProperties} aria-label="Use Yellow ink" aria-pressed="false" title="Yellow" type="button"></button>
          <button id="color-custom-toggle" className="add-color" type="button" aria-label="Choose a custom ink color" aria-controls="color-custom-panel" aria-expanded="false" title="Custom color">
            <Icon name="plus" />
          </button>
        </div>
        <form id="color-custom-panel" className="color-custom-panel" hidden>
          <div className="color-custom-heading"><strong>Custom ink</strong><span id="color-custom-preview" className="color-custom-preview" aria-hidden="true" /></div>
          <label className="color-hue-label" htmlFor="color-hue">Hue</label>
          <input id="color-hue" className="color-hue" type="range" min="0" max="359" defaultValue="210" aria-label="Custom color hue" />
          <div className="color-custom-entry">
            <label htmlFor="color-custom">Hex color
              <input id="color-custom" type="text" defaultValue="#121619" maxLength={7} spellCheck={false} autoCapitalize="off" aria-label="Custom ink color hex code" />
            </label>
            <button id="color-custom-apply" type="submit">Use color</button>
          </div>
          <p id="color-custom-error" className="color-custom-error" role="alert" hidden>Enter a six-digit hex color.</p>
        </form>
        <p id="color-warning" className="color-warning" role="status" hidden>This color may be hard to see on this paper.</p>
      </div>
      <div id="template-menu" className="template-picker-popover" role="group" aria-label="Paper templates" hidden>
        <span className="color-picker-label">Paper style</span>
        <button id="template-option-blank" className="template-option" data-template="blank" aria-pressed="false" type="button"><span className="template-mini" data-template="blank" aria-hidden="true" /><span>Blank</span></button>
        <button id="template-option-ruled" className="template-option" data-template="ruled" aria-pressed="true" type="button"><span className="template-mini" data-template="ruled" aria-hidden="true" /><span>Ruled</span></button>
        <button id="template-option-grid" className="template-option" data-template="grid" aria-pressed="false" type="button"><span className="template-mini" data-template="grid" aria-hidden="true" /><span>Grid</span></button>
        <button id="template-option-dots" className="template-option" data-template="dots" aria-pressed="false" type="button"><span className="template-mini" data-template="dots" aria-hidden="true" /><span>Dots</span></button>
      </div>
      <div id="lasso-actions" className="lasso-actions" role="group" aria-label="Selected ink actions" hidden>
        <button id="lasso-move" className="button button-strong" type="button" disabled>Move selected ink</button>
        <button id="lasso-delete" className="button button-danger" type="button" disabled>Delete selected ink</button>
        <button id="lasso-cancel" className="button" type="button">Cancel selection</button>
      </div>

      <dialog id="readback-panel" className="scrim right" aria-labelledby="readback-heading" hidden>
        <aside className="readback-panel" aria-labelledby="readback-heading">
          <div className="panel-heading">
            <div><p className="eyebrow">Recognition</p><h2 id="readback-heading" tabIndex={-1}>Readback</h2></div>
            <button id="close-readback" aria-label="Close Readback" className="icon-button" type="button"><Icon name="close" /></button>
          </div>
          <p className="panel-intro">Check what CalcInk read from your handwriting. Your ink never leaves this device.</p>
          <div id="line-list" className="line-list" aria-label="Equation lines"></div>
          <div id="line-detail" className="line-detail" hidden>
            <div className="read-card-top"><span id="selected-line-label">Selected line</span><span id="selected-line-status" className="pill">Reading</span></div>
            <p className="detail-label">Restricted OCR read</p>
            <p id="raw-read" className="read-value"></p>
            <p id="unmasked-read" className="read-value" hidden></p>
            <p className="detail-label">Interpreted equation</p>
            <p id="normalized-read" className="read-expression"></p>
            <p id="line-result" className="result-value"></p>
            <p id="line-message" className="line-message"></p>
            <form id="correction-form">
              <label htmlFor="correction-input">Correct the equation</label>
              <input id="correction-input" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={512} placeholder="11+11=" aria-describedby="correction-error" />
              <p id="correction-error" className="field-error" role="alert" hidden></p>
              <button className="button button-strong" type="submit">Use correction</button>
            </form>
            <div id="sample-export" className="sample-export" hidden>
              <p>Export the first model read and this line's ink as a private JSON file. Nothing is uploaded.</p>
              <button id="export-sample" className="button" type="button">Export sample</button>
            </div>
          </div>
          <p id="readback-empty" className="panel-empty">No ink lines yet. Draw an expression to begin.</p>
          <p className="privacy-note"><strong>Private by design.</strong> Recognition runs locally after the model is downloaded.</p>
        </aside>
      </dialog>

      <dialog id="pages-dialog" className="pages-panel" aria-labelledby="pages-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">Notebook</p><h2 id="pages-heading">Pages</h2></div>
          <button id="close-pages" aria-label="Close pages" className="icon-button" type="button"><Icon name="close" /></button>
        </div>
        <p className="panel-intro">Pages are stored only in this browser. Clearing site data removes them.</p>
        <button id="new-page" className="new-page" type="button"><Icon name="plus" /> New page</button>
        <div id="page-list" className="page-list"></div>
      </dialog>

      <dialog id="delete-dialog" className="confirm-dialog" aria-labelledby="delete-heading">
        <span className="modal-icon"><Icon name="trash" /></span>
        <h2 id="delete-heading">Delete this page?</h2>
        <p id="delete-message"></p>
        <div className="dialog-actions">
          <button id="cancel-delete" className="button" type="button">Cancel</button>
          <button id="confirm-delete" className="button button-danger" type="button">Delete page</button>
        </div>
      </dialog>
      <dialog id="clear-dialog" className="confirm-dialog" aria-labelledby="clear-heading">
        <span className="modal-icon"><Icon name="trash" /></span>
        <h2 id="clear-heading">Clear this page?</h2>
        <p>All ink on this page will be removed. You can undo this right after clearing.</p>
        <div className="dialog-actions">
          <button id="cancel-clear" className="button" type="button">Cancel</button>
          <button id="confirm-clear" className="button button-danger" type="button">Clear page</button>
        </div>
      </dialog>
      <div id="system-announcement" className="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="live-region" className="sr-only" aria-live="polite" aria-atomic="true"></div>
    </div>
  );
}

function element<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing interface element: ${selector}`);
  return found;
}

export function mountShell(root: HTMLElement) {
  // The V1 controller owns live DOM state; React owns this stable visual frame.
  flushSync(() => createRoot(root).render(<ShellView />));
  return {
    root,
    pageTitle: element<HTMLElement>(root, "#page-title"),
    homeButton: element<HTMLButtonElement>(root, "#home-button"),
    pagesButton: element<HTMLButtonElement>(root, "#pages-button"),
    quickNewPage: element<HTMLButtonElement>(root, "#quick-new-page"),
    prevPage: element<HTMLButtonElement>(root, "#prev-page"),
    nextPage: element<HTMLButtonElement>(root, "#next-page"),
    pagePosition: element<HTMLElement>(root, "#page-position"),
    zoomSlider: element<HTMLInputElement>(root, "#zoom-slider"),
    zoomValue: element<HTMLOutputElement>(root, "#zoom-value"),
    printPage: element<HTMLButtonElement>(root, "#print-page"),
    moreButton: element<HTMLButtonElement>(root, "#more-button"),
    moreMenu: element<HTMLElement>(root, "#more-menu"),
    readbackButton: element<HTMLButtonElement>(root, "#readback-button"),
    saveStatus: element<HTMLElement>(root, "#save-status"),
    recognitionStatus: element<HTMLElement>(root, "#recognition-status"),
    offlineStatus: element<HTMLElement>(root, "#offline-status"),
    retrySave: element<HTMLButtonElement>(root, "#retry-save"),
    retryRecognition: element<HTMLButtonElement>(root, "#retry-recognition"),
    retryOffline: element<HTMLButtonElement>(root, "#retry-offline"),
    updateButton: element<HTMLButtonElement>(root, "#update-button"),
    revealAnswer: element<HTMLButtonElement>(root, "#reveal-answer"),
    errorBanner: element<HTMLElement>(root, "#error-banner"),
    errorText: element<HTMLElement>(root, "#error-text"),
    exportRecovery: element<HTMLButtonElement>(root, "#export-recovery"),
    startFresh: element<HTMLButtonElement>(root, "#start-fresh"),
    retryStorage: element<HTMLButtonElement>(root, "#retry-storage"),
    toolButtons: [...root.querySelectorAll<HTMLButtonElement>("[data-tool]")],
    colorMenuButton: element<HTMLButtonElement>(root, "#color-menu-button"),
    colorPanel: element<HTMLElement>(root, "#color-panel"),
    colorButtons: [...root.querySelectorAll<HTMLButtonElement>("[data-color]")],
    colorCustomToggle: element<HTMLButtonElement>(root, "#color-custom-toggle"),
    colorCustomPanel: element<HTMLFormElement>(root, "#color-custom-panel"),
    colorCustom: element<HTMLInputElement>(root, "#color-custom"),
    colorHue: element<HTMLInputElement>(root, "#color-hue"),
    colorCustomPreview: element<HTMLElement>(root, "#color-custom-preview"),
    colorCustomError: element<HTMLElement>(root, "#color-custom-error"),
    colorWarning: element<HTMLElement>(root, "#color-warning"),
    paperTemplate: element<HTMLButtonElement>(root, "#paper-template"),
    paperTemplateLabel: element<HTMLElement>(root, "#paper-template-label"),
    templateMenu: element<HTMLElement>(root, "#template-menu"),
    templateButtons: [...root.querySelectorAll<HTMLButtonElement>(".template-option")],
    penOnlyMode: element<HTMLInputElement>(root, "#pen-only-mode"),
    lassoActions: element<HTMLElement>(root, "#lasso-actions"),
    lassoMove: element<HTMLButtonElement>(root, "#lasso-move"),
    lassoDelete: element<HTMLButtonElement>(root, "#lasso-delete"),
    lassoCancel: element<HTMLButtonElement>(root, "#lasso-cancel"),
    penWidth: element<HTMLInputElement>(root, "#pen-width"),
    widthValue: element<HTMLOutputElement>(root, "#width-value"),
    widthDot: element<HTMLElement>(root, "#width-dot"),
    undoButton: element<HTMLButtonElement>(root, "#undo-button"),
    redoButton: element<HTMLButtonElement>(root, "#redo-button"),
    clearButton: element<HTMLButtonElement>(root, "#clear-button"),
    clearMenuButton: element<HTMLButtonElement>(root, "#clear-menu-button"),
    workspace: element<HTMLElement>(root, "#workspace"),
    notebookStack: element<HTMLElement>(root, "#notebook-stack"),
    paperWrap: element<HTMLElement>(root, ".paper-wrap"),
    paper: element<HTMLElement>(root, "#paper"),
    inkCanvas: element<HTMLCanvasElement>(root, "#ink-canvas"),
    answerCanvas: element<HTMLCanvasElement>(root, "#answer-canvas"),
    draftCanvas: element<HTMLCanvasElement>(root, "#draft-canvas"),
    drawingSurface: element<HTMLElement>(root, "#drawing-surface"),
    readbackPanel: element<HTMLDialogElement>(root, "#readback-panel"),
    readbackHeading: element<HTMLElement>(root, "#readback-heading"),
    closeReadback: element<HTMLButtonElement>(root, "#close-readback"),
    lineList: element<HTMLElement>(root, "#line-list"),
    lineDetail: element<HTMLElement>(root, "#line-detail"),
    selectedLineLabel: element<HTMLElement>(root, "#selected-line-label"),
    selectedLineStatus: element<HTMLElement>(root, "#selected-line-status"),
    rawRead: element<HTMLElement>(root, "#raw-read"),
    unmaskedRead: element<HTMLElement>(root, "#unmasked-read"),
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
    clearDialog: element<HTMLDialogElement>(root, "#clear-dialog"),
    cancelClear: element<HTMLButtonElement>(root, "#cancel-clear"),
    confirmClear: element<HTMLButtonElement>(root, "#confirm-clear"),
    systemAnnouncement: element<HTMLElement>(root, "#system-announcement"),
    liveRegion: element<HTMLElement>(root, "#live-region"),
  };
}

export type Shell = ReturnType<typeof mountShell>;
