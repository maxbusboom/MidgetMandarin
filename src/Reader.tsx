import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WordPopup } from "./WordPopup";
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

type WordClick = (word: string, position: { x: number; y: number }) => void;

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
                {item.tokens.map(([text, bucket], tokenIdx) =>
                  text.trim() ? (
                    <span
                      key={tokenIdx}
                      onClick={(e) => onWordClick(text, { x: e.clientX, y: e.clientY })}
                      className={`cursor-pointer hover:underline ${BUCKET_CLASS[bucket]}`}
                    >
                      {text}
                    </span>
                  ) : (
                    <span key={tokenIdx}>{text}</span>
                  ),
                )}
              </span>
            ),
          )}
        </div>
      ))}
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
  const [pageNumber, setPageNumber] = useState(0);
  const [page, setPage] = useState<PageImage | null>(null);
  const [error, setError] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setPage(null);
    setError("");
    invoke<PageImage>("get_page_image", { id, pageNumber })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }, [id, pageNumber]);

  function updateScale() {
    if (imgRef.current) {
      setScale(imgRef.current.clientWidth / imgRef.current.naturalWidth);
    }
  }

  useEffect(() => {
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [page]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-center gap-3 text-sm">
        <button
          disabled={pageNumber === 0}
          onClick={() => setPageNumber((p) => p - 1)}
          className="rounded bg-gray-100 px-2 py-1 disabled:opacity-40"
        >
          ← Prev
        </button>
        <span>
          Page {pageNumber + 1} of {pageCount}
        </span>
        <button
          disabled={pageNumber >= pageCount - 1}
          onClick={() => setPageNumber((p) => p + 1)}
          className="rounded bg-gray-100 px-2 py-1 disabled:opacity-40"
        >
          Next →
        </button>
      </div>

      {error && <p className="text-center text-red-600">{error}</p>}

      {page && (
        <div className="relative mx-auto" style={{ width: "fit-content" }}>
          <img
            ref={imgRef}
            src={`data:image/png;base64,${page.image_data}`}
            alt={`Page ${pageNumber + 1}`}
            onLoad={updateScale}
            className="mx-auto max-w-full border border-gray-200 shadow-sm"
          />
          {page.words.map((w, i) => (
            <div
              key={i}
              onClick={(e) => onWordClick(w.text, { x: e.clientX, y: e.clientY })}
              title={w.text}
              className="absolute cursor-pointer hover:bg-yellow-300/30"
              style={{
                left: w.x0 * scale,
                top: w.y0 * scale,
                width: (w.x1 - w.x0) * scale,
                height: (w.y1 - w.y0) * scale,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Reader({ id, onBack }: { id: number; onBack: () => void }) {
  const [doc, setDoc] = useState<DocumentText | null>(null);
  const [charSet, setCharSet] = useState<"simplified" | "traditional">("simplified");
  const [view, setView] = useState<"reflow" | "pages">("reflow");
  const [error, setError] = useState("");
  const [popup, setPopup] = useState<{ word: string; position: { x: number; y: number } } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const { settings, update: updateSettings } = useReadingSettings();

  useEffect(() => {
    invoke<DocumentText>("get_document", { id })
      .then((d) => {
        setDoc(d);
        setCharSet(d.character_set);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  function handleWordClick(word: string, position: { x: number; y: number }) {
    setPopup({ word, position });
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
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

      {doc && (
        <>
          <h1 className="mb-1 text-xl font-semibold">{doc.title}</h1>
          {doc.page_count != null && (
            <p className="mb-4 text-sm text-gray-500">
              {doc.page_count} page{doc.page_count === 1 ? "" : "s"}
            </p>
          )}

          {view === "reflow" ? (
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
          ) : (
            <OriginalPages id={id} pageCount={doc.page_count ?? 1} onWordClick={handleWordClick} />
          )}
        </>
      )}

      {popup && (
        <WordPopup
          word={popup.word}
          position={popup.position}
          sourceDocId={id}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
