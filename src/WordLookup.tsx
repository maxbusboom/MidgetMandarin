import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

interface WordResult {
  traditional: string;
  simplified: string;
  pinyin: string;
  definition: string;
  vocab_id: number | null;
}

// The dictionary lookup + vocab-toggle + AI-help guts, shared between the
// inline WordPopup and the detachable DictionaryWindow (Phase 6) so both
// stay in sync without duplicating the logic.
export function WordLookupPanel({
  word,
  sourceDocId,
  context,
  headerActions,
}: {
  word: string;
  sourceDocId: number | null;
  context?: string;
  headerActions?: React.ReactNode;
}) {
  const [results, setResults] = useState<WordResult[] | null>(null);
  const [error, setError] = useState("");
  const [aiHelp, setAiHelp] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    setResults(null);
    setError("");
    setAiHelp("");
    setAiError("");
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
      // Lets any open Vocab panel / other DictionaryWindow refresh — vocab
      // membership is shared state across windows (Phase 6).
      emit("vocab-changed");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleUseInSentence() {
    setAiLoading(true);
    setAiError("");
    try {
      setAiHelp(await invoke<string>("ai_use_in_sentence", { word }));
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  // Segmentation fallback: jieba+CEDICT found nothing, which is the real,
  // detectable signal that this span may be poetry/classical Chinese/a name
  // rather than a plain lookup miss.
  async function handleAskAi() {
    setAiLoading(true);
    setAiError("");
    try {
      setAiHelp(await invoke<string>("ai_explain_span", { span: word, context: context || word }));
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-zh-simplified text-lg font-semibold">{word}</span>
        {headerActions}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && results === null && <p className="text-sm text-gray-400">Looking up…</p>}
      {results !== null && results.length === 0 && (
        <p className="mb-2 text-sm text-gray-400">No dictionary entry found.</p>
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

      {results !== null && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          {!aiHelp && !aiLoading && (
            <button
              onClick={results.length > 0 ? handleUseInSentence : handleAskAi}
              className="w-full rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 hover:bg-gray-200"
            >
              {results.length > 0 ? "✨ Use in a sentence" : "✨ Ask AI about this"}
            </button>
          )}
          {aiLoading && <p className="text-xs text-gray-400">Asking AI…</p>}
          {aiError && <p className="text-xs text-red-600">{aiError}</p>}
          {aiHelp && <p className="whitespace-pre-wrap text-sm">{aiHelp}</p>}
        </div>
      )}
    </div>
  );
}
