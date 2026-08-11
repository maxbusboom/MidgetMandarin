import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface WordResult {
  traditional: string;
  simplified: string;
  pinyin: string;
  definition: string;
  vocab_id: number | null;
}

export function WordPopup({
  word,
  position,
  sourceDocId,
  onClose,
}: {
  word: string;
  position: { x: number; y: number };
  sourceDocId: number | null;
  onClose: () => void;
}) {
  const [results, setResults] = useState<WordResult[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setResults(null);
    setError("");
    invoke<WordResult[]>("lookup_word", { word })
      .then(setResults)
      .catch((e) => setError(String(e)));
  }, [word]);

  async function toggleVocab(entry: WordResult, index: number) {
    try {
      if (entry.vocab_id != null) {
        await invoke("remove_vocab", { id: entry.vocab_id });
        setResults((prev) => prev && prev.map((r, i) => (i === index ? { ...r, vocab_id: null } : r)));
      } else {
        const added = await invoke<{ id: number }>("add_vocab", {
          simplified: entry.simplified,
          traditional: entry.traditional,
          pinyin: entry.pinyin,
          definition: entry.definition,
          sourceDocId,
        });
        setResults((prev) => prev && prev.map((r, i) => (i === index ? { ...r, vocab_id: added.id } : r)));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  const style = {
    left: Math.min(position.x, window.innerWidth - 288),
    top: Math.min(position.y + 12, window.innerHeight - 240),
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        style={style}
        className="fixed z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-zh-simplified text-lg font-semibold">{word}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && results === null && <p className="text-sm text-gray-400">Looking up…</p>}
        {results !== null && results.length === 0 && (
          <p className="text-sm text-gray-400">No dictionary entry found.</p>
        )}

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {results?.map((r, i) => (
            <div key={i} className="border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-gray-500">{r.pinyin}</span>
                <button
                  onClick={() => toggleVocab(r, i)}
                  className={`shrink-0 rounded px-2 py-0.5 text-xs ${
                    r.vocab_id != null ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {r.vocab_id != null ? "− Remove" : "+ Add"}
                </button>
              </div>
              <p className="text-sm">{r.definition}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
