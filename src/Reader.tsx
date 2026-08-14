import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WordPopup } from "./WordPopup";
import { ChatPanel } from "./ChatPanel";
import { fontFamilyFor, ReadingSettingsPopover, useReadingSettings } from "./ReadingSettings";

type Bucket = "n" | "v" | "a" | "o";
type Token = [string, Bucket];
type ContentItem =
  | { type: "text"; tokens: Token[] }
  | { type: "image"; data: string; ext: string; width: number; height: number };

interface DocumentText {
  title: string;
  character_set: "simplified" | "traditional";
  page_count: number | null;
  extracted_text: string;
  content_blocks: ContentItem[][] | null;
}

interface WordBox {
  text: string;
  pos: Bucket;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PageImage {
  image_data: string;
  width: number;
  height: number;
  words: WordBox[];
}

type WordClick = (word: string, position: { x: number; y: number }, context?: string) => void;

// Faint per PLAN.md's "faintly highlighted" — light tints only, everything
// else (particles, punctuation, numbers, ...) stays plain.
const BUCKET_CLASS: Record<Bucket, string> = {
  n: "bg-sky-100",
  v: "bg-emerald-100",
  a: "bg-fuchsia-100",
  o: "",
};

function Reflow({
  blocks,
  plainText,
  textStyle,
  onWordClick,
}: {
  blocks: ContentItem[][] | null;
  plainText: string;
  textStyle: React.CSSProperties;
  onWordClick: WordClick;
}) {
  if (!blocks) {
    // Pre-Phase-2 imports have no content_blocks — fall back to plain text
    // rather than crash on the missing structure.
    return <div className="whitespace-pre-wrap" style={textStyle}>{plainText}</div>;
  }

  return (
    <div style={textStyle}>
      {blocks.map((page, pageIdx) => (
        <div key={pageIdx} className="mb-8 whitespace-pre-wrap">
          {page.map((item, itemIdx) =>
            item.type === "image" ? (
              <img
                key={itemIdx}
                src={`data:image/${item.ext};base64,${item.data}`}
                alt=""
                className="my-4 max-w-full rounded border border-gray-200"
              />
            ) : (
              <span key={itemIdx}>
                {(() => {
                  const sentenceContext = item.tokens.map(([t]) => t).join("");
                  return item.tokens.map(([text, bucket], tokenIdx) =>
                    text.trim() ? (
                      <span
                        key={tokenIdx}
                        onClick={(e) => onWordClick(text, { x: e.clientX, y: e.clientY }, sentenceContext)}
                        className={`cursor-pointer hover:underline ${BUCKET_CLASS[bucket]}`}
                      >
                        {text}
                      </span>
                    ) : (
                      <span key={tokenIdx}>{text}</span>
                    ),
                  );
                })()}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

// Same faint tint used in Reflow, but with alpha so the underlying rendered
// glyphs (baked into the page image) stay legible under the highlight.
const OVERLAY_BUCKET_CLASS: Record<Bucket, string> = {
  n: "bg-sky-300/40",
  v: "bg-emerald-300/40",
  a: "bg-fuchsia-300/40",
  o: "",
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

function PageSlot({
  id,
  pageNumber,
  containerWidth,
  zoom,
  onWordClick,
}: {
  id: number;
  pageNumber: number;
  containerWidth: number;
  zoom: number;
  onWordClick: WordClick;
}) {
  const [page, setPage] = useState<PageImage | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Load lazily (with a generous rootMargin so it's ready just before it
  // scrolls into view) rather than fetching every page up front. This only
  // decides *whether* to load — which page is "current" for the page
  // indicator is computed separately in the parent from scroll position, so
  // there's a single source of truth instead of every page's observer
  // racing to report itself.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShouldLoad(true);
      },
      { root: null, rootMargin: "800px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad || page) return;
    invoke<PageImage>("get_page_image", { id, pageNumber })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }, [shouldLoad, page, id, pageNumber]);

  function updateScale() {
    if (imgRef.current) {
      setScale(imgRef.current.clientWidth / imgRef.current.naturalWidth);
    }
  }
  useEffect(updateScale, [page, containerWidth, zoom]);

  const displayWidth = Math.max(1, containerWidth * zoom);
  const placeholderHeight = page ? displayWidth * (page.height / page.width) : displayWidth * 1.414;

  return (
    <div ref={rootRef} className="mb-4 flex justify-center" data-page-number={pageNumber}>
      {error ? (
        <p className="text-red-600">{error}</p>
      ) : page ? (
        <div className="relative" style={{ width: displayWidth }}>
          <img
            ref={imgRef}
            src={`data:image/png;base64,${page.image_data}`}
            alt={`Page ${pageNumber + 1}`}
            onLoad={updateScale}
            className="w-full border border-gray-200 shadow-sm"
          />
          {page.words.map((w, i) => (
            <div
              key={i}
              onClick={(e) => onWordClick(w.text, { x: e.clientX, y: e.clientY })}
              title={w.text}
              className={`absolute cursor-pointer hover:bg-yellow-300/40 ${OVERLAY_BUCKET_CLASS[w.pos]}`}
              style={{
                left: w.x0 * scale,
                top: w.y0 * scale,
                width: (w.x1 - w.x0) * scale,
                height: (w.y1 - w.y0) * scale,
              }}
            />
          ))}
        </div>
      ) : (
        <div
          className="animate-pulse rounded bg-gray-100"
          style={{ width: displayWidth, height: placeholderHeight }}
        />
      )}
    </div>
  );
}

function OriginalPages({
  id,
  pageCount,
  onWordClick,
}: {
  id: number;
  pageCount: number;
  onWordClick: WordClick;
}) {
  const [visiblePage, setVisiblePage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The "current" page for the indicator/Prev-Next is whichever page has
  // the most vertical overlap with the scroll viewport — computed directly
  // from layout on every scroll rather than from per-page visibility
  // callbacks, so there's exactly one deterministic answer even mid-scroll.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let raf = 0;
    function updateVisiblePage() {
      raf = 0;
      const containerRect = container!.getBoundingClientRect();
      let best = 0;
      let bestOverlap = -Infinity;
      pageRefs.current.forEach((el, idx) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const overlap = Math.min(rect.bottom, containerRect.bottom) - Math.max(rect.top, containerRect.top);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = idx;
        }
      });
      setVisiblePage(best);
    }
    function onScroll() {
      if (!raf) raf = requestAnimationFrame(updateVisiblePage);
    }
    updateVisiblePage();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pageCount]);

  function scrollToPage(n: number) {
    pageRefs.current[n]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <button
            disabled={visiblePage === 0}
            onClick={() => scrollToPage(visiblePage - 1)}
            className="rounded bg-gray-100 px-2 py-1 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>
            Page {visiblePage + 1} of {pageCount}
          </span>
          <button
            disabled={visiblePage >= pageCount - 1}
            onClick={() => scrollToPage(visiblePage + 1)}
            className="rounded bg-gray-100 px-2 py-1 disabled:opacity-40"
          >
            Next →
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            className="rounded bg-gray-100 px-2 py-1"
            title="Zoom out"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            className="rounded bg-gray-100 px-2 py-1"
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={() => setZoom(1)}
            title="Fit page to window width"
            className="rounded bg-gray-100 px-2 py-1"
          >
            Fit width
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="h-[calc(100vh-190px)] overflow-y-auto">
        {Array.from({ length: pageCount }, (_, pageNumber) => (
          <div
            key={pageNumber}
            ref={(el) => {
              pageRefs.current[pageNumber] = el;
            }}
          >
            <PageSlot
              id={id}
              pageNumber={pageNumber}
              containerWidth={containerWidth}
              zoom={zoom}
              onWordClick={onWordClick}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Reader({ id, onBack }: { id: number; onBack: () => void }) {
  const [doc, setDoc] = useState<DocumentText | null>(null);
  const [charSet, setCharSet] = useState<"simplified" | "traditional">("simplified");
  const [view, setView] = useState<"reflow" | "pages">("reflow");
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<{ word: string; position: { x: number; y: number }; context?: string } | null>(
    null,
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const { settings, update: updateSettings } = useReadingSettings();

  useEffect(() => {
    invoke<DocumentText>("get_document", { id })
      .then((d) => {
        setDoc(d);
        setCharSet(d.character_set);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  function handleWordClick(word: string, position: { x: number; y: number }, context?: string) {
    setPopup({ word, position, context });
  }

  return (
    <div className="w-full p-6">
      <div className="relative mb-4 flex items-center justify-between">
        <button onClick={onBack} className="text-blue-600 hover:underline">
          ← Library
        </button>
        <div className="flex gap-3 text-sm">
          <div className="flex gap-1">
            <button
              onClick={() => setView("reflow")}
              className={`rounded px-2 py-1 ${view === "reflow" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            >
              Reflow
            </button>
            <button
              onClick={() => setView("pages")}
              className={`rounded px-2 py-1 ${view === "pages" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
            >
              Original Pages
            </button>
          </div>
          {view === "reflow" && (
            <>
              <div className="flex gap-1">
                <button
                  onClick={() => setCharSet("simplified")}
                  className={`rounded px-2 py-1 ${charSet === "simplified" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
                >
                  简体
                </button>
                <button
                  onClick={() => setCharSet("traditional")}
                  className={`rounded px-2 py-1 ${charSet === "traditional" ? "bg-blue-600 text-white" : "bg-gray-100"}`}
                >
                  繁體
                </button>
              </div>
              <button
                onClick={() => setShowSettings((s) => !s)}
                title="Reading settings"
                className={`rounded px-2 py-1 font-serif ${showSettings ? "bg-blue-600 text-white" : "bg-gray-100"}`}
              >
                Aa
              </button>
            </>
          )}
          <button
            onClick={() => setShowChat((s) => !s)}
            className={`rounded px-2 py-1 ${showChat ? "bg-blue-600 text-white" : "bg-gray-100"}`}
          >
            ✨ Chat
          </button>
        </div>

        {showSettings && (
          <ReadingSettingsPopover
            settings={settings}
            onChange={updateSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>

      {error && <p className="text-red-600">{error}</p>}

      {doc && view === "reflow" && (
        <div style={{ width: `${settings.text_width_pct}%`, marginLeft: "auto", marginRight: "auto" }}>
          <h1 className="mb-1 text-xl font-semibold">{doc.title}</h1>
          {doc.page_count != null && (
            <p className="mb-4 text-sm text-gray-500">
              {doc.page_count} page{doc.page_count === 1 ? "" : "s"}
            </p>
          )}
          <Reflow
            blocks={doc.content_blocks}
            plainText={doc.extracted_text}
            textStyle={{
              fontFamily: fontFamilyFor(charSet, settings.font_family),
              fontSize: settings.font_size,
              lineHeight: settings.line_height,
            }}
            onWordClick={handleWordClick}
          />
        </div>
      )}

      {doc && view === "pages" && (
        // Full width regardless of the Reflow-only text-width setting — the
        // zoom control below is Original Pages' own way to scale to the
        // screen, independent of reading-column width preferences.
        <div className="w-full">
          <h1 className="mb-1 text-xl font-semibold">{doc.title}</h1>
          <OriginalPages id={id} pageCount={doc.page_count ?? 1} onWordClick={handleWordClick} />
        </div>
      )}

      {popup && (
        <WordPopup
          word={popup.word}
          position={popup.position}
          context={popup.context}
          sourceDocId={id}
          onClose={() => setPopup(null)}
        />
      )}

      {showChat && <ChatPanel docId={id} onClose={() => setShowChat(false)} />}
    </div>
  );
}
