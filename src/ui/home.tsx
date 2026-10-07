import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "./home.css";

export type LibraryKind = "notebook" | "whiteboard";

export type LibraryItem = {
  id: string;
  title: string;
  kind: LibraryKind;
};

type HomeActions = {
  items: LibraryItem[];
  onCreate: (kind: LibraryKind) => void;
  onOpen: (id: string) => void;
};

function LibraryArt() {
  return (
    <svg className="library-art" viewBox="0 0 360 260" fill="none" aria-hidden="true">
      <g stroke="#b9cce0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M130 68c3-18 19-30 35-29 4-14 16-23 30-23 13 0 23 8 27 20 15-5 30 3 34 18 13-1 23 8 23 21H130c-5-5-4-15 0-19Z" fill="#25282e" />
        <path d="M166 65c2-7 10-10 17-6m15-22c10 0 17 7 17 16m15-2c8-2 16 4 17 12" />
        <path d="M117 75c-27 18-42 40-47 68m177-68c27 18 42 40 47 68M103 92c-12 12-20 25-24 42m181-42c12 12 20 25 24 42" />
        <path d="m85 156-49-12-18 92 65 13 17-93-15-13Z" fill="#252a31" />
        <path d="m85 156-3 15 18 3m-57 47 35 7" />
        <path d="m55 205 58-18 20 55-58 18-20-55Z" fill="#26303c" />
        <path d="M78 231c2-8 8-12 15-13-4-5-2-12 4-14 6-2 11 3 10 9 7 2 12 7 14 14" />
        <path d="M128 122c0-5 4-9 9-9h96c5 0 9 4 9 9v111c0 5-4 9-9 9h-96c-5 0-9-4-9-9V122Z" fill="#222a45" />
        <path d="M139 114v128m8-129v128m74-128v18l7-5 7 5v-18" />
        <path d="M168 176c8 13 26 16 37 2m-30-18h.1m19 0h.1M214 219h16m-16 9h16" />
        <path d="m268 136 18 15-79 88-15 6 4-16 72-93Z" fill="#2d3542" />
        <path d="m263 143 18 15m-85 71 11 10" />
        <path d="m277 186 53 12-16 58-70-13 11-43c2-11 10-16 22-14Z" fill="#252d37" />
        <path d="m281 183 4-26 42 10-5 29m-74 9 47 9" />
      </g>
    </svg>
  );
}

function NewMenu({ onCreate }: { onCreate: HomeActions["onCreate"] }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)
        && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const create = (kind: LibraryKind) => {
    setOpen(false);
    onCreate(kind);
  };

  return (
    <div className="library-create">
      <button
        ref={trigger}
        className="library-new-button"
        type="button"
        data-testid="library-new"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="library-create-menu"
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" /></svg>
        <span>New</span>
        <svg className="library-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div ref={menu} className="library-create-menu" id="library-create-menu">
          <button type="button" data-testid="create-notebook" onClick={() => create("notebook")}>
            <span className="library-option-icon library-option-paper" aria-hidden="true"><span /></span>
            <span><strong>New notebook</strong><small>Scrollable A4 pages</small></span>
          </button>
          <button type="button" data-testid="create-whiteboard" onClick={() => create("whiteboard")}>
            <span className="library-option-icon library-option-board" aria-hidden="true"><span /></span>
            <span><strong>New black canvas</strong><small>Infinite space for ideas</small></span>
          </button>
        </div>
      )}
    </div>
  );
}

function HomeView({ items, onCreate, onOpen }: HomeActions) {
  const empty = items.length === 0;
  return (
    <div className="calcink-home" data-testid="library-home">
      {empty ? (
        <main className="library-empty">
          <LibraryArt />
          <h1>Ready to fill your library with life?</h1>
          <p>Create a notebook or a black infinite canvas to get started.</p>
          <NewMenu onCreate={onCreate} />
        </main>
      ) : (
        <>
          <header className="library-header">
            <div>
              <span className="library-brand">CalcInk</span>
              <h1>Your library</h1>
            </div>
            <NewMenu onCreate={onCreate} />
          </header>
          <main className="library-content">
            <p className="library-section-label">Your work <span>{items.length}</span></p>
            <div className="library-grid">
              {items.map((item) => (
                <button
                  className="library-item"
                  type="button"
                  key={item.id}
                  aria-label={`Open ${item.title}`}
                  onClick={() => onOpen(item.id)}
                >
                  <span className={`library-item-preview library-preview-${item.kind}`} aria-hidden="true">
                    <span />
                  </span>
                  <span className="library-item-title">{item.title}</span>
                  <span className="library-item-kind">{item.kind === "notebook" ? "Notebook" : "Black canvas"}</span>
                </button>
              ))}
            </div>
          </main>
        </>
      )}
    </div>
  );
}

export function mountHome(host: HTMLElement, actions: HomeActions) {
  const root = createRoot(host);
  const render = (items: LibraryItem[]) => flushSync(() => root.render(<HomeView {...actions} items={items} />));
  render(actions.items);
  return {
    update: render,
    destroy: () => root.unmount(),
  };
}
