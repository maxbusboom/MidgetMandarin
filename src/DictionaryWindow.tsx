import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { WordLookupPanel } from "./WordLookup";

interface WordSelected {
  word: string;
  context: string | null;
  sourceDocId: number | null;
}

// The detached dictionary popout (Phase 6): a persistent window that stays
// open across word clicks in any reader window, rather than the ephemeral
// inline WordPopup. Seeded from URL params on first open (see WordPopup's
// handleDetach) and kept live afterwards via the "word-selected" broadcast.
export function DictionaryWindow() {
  const initial = new URLSearchParams(window.location.search);
  const [selection, setSelection] = useState<WordSelected | null>(
    initial.get("word")
      ? {
          word: initial.get("word")!,
          context: initial.get("context"),
          sourceDocId: initial.get("docId") ? Number(initial.get("docId")) : null,
        }
      : null,
  );

  useEffect(() => {
    const unlisten = listen<WordSelected>("word-selected", (event) => setSelection(event.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-y-auto bg-white p-4">
      <h1 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Dictionary</h1>
      {selection ? (
        <WordLookupPanel
          word={selection.word}
          context={selection.context ?? undefined}
          sourceDocId={selection.sourceDocId}
        />
      ) : (
        <p className="text-sm text-gray-400">Click a word in a document to look it up here.</p>
      )}
    </div>
  );
}
