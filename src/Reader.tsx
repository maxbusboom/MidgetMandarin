import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

interface PageImage {
  image_data: string;
  width: number;
  height: number;
}

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
  fontClass,
}: {
  blocks: ContentItem[][] | null;
  plainText: string;
  fontClass: string;
}) {
  if (!blocks) {
    // Pre-Phase-2 imports have no content_blocks — fall back to plain text
    // rather than crash on the missing structure.
    return <div className={`whitespace-pre-wrap text-lg leading-relaxed ${fontClass}`}>{plainText}</div>;
  }

  return (
    <div className={`text-lg leading-relaxed ${fontClass}`}>
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
                {item.tokens.map(([text, bucket], tokenIdx) => (
                  <span key={tokenIdx} className={BUCKET_CLASS[bucket]}>
                    {text}
                  </span>
                ))}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function OriginalPages({ id, pageCount }: { id: number; pageCount: number }) {
  const [pageNumber, setPageNumber] = useState(0);
  const [page, setPage] = useState<PageImage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setPage(null);
    setError("");
    invoke<PageImage>("get_page_image", { id, pageNumber })
      .then(setPage)
      .catch((e) => setError(String(e)));
  }, [id, pageNumber]);

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
        <img
          src={`data:image/png;base64,${page.image_data}`}
          alt={`Page ${pageNumber + 1}`}
          className="mx-auto max-w-full border border-gray-200 shadow-sm"
        />
      )}
    </div>
  );
}

export function Reader({ id, onBack }: { id: number; onBack: () => void }) {
  const [doc, setDoc] = useState<DocumentText | null>(null);
  const [charSet, setCharSet] = useState<"simplified" | "traditional">("simplified");
  const [view, setView] = useState<"reflow" | "pages">("reflow");
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<DocumentText>("get_document", { id })
      .then((d) => {
        setDoc(d);
        setCharSet(d.character_set);
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
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
          )}
        </div>
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
              fontClass={charSet === "simplified" ? "font-zh-simplified" : "font-zh-traditional"}
            />
          ) : (
            <OriginalPages id={id} pageCount={doc.page_count ?? 1} />
          )}
        </>
      )}
    </div>
  );
}
