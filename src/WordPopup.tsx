import { emit } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { WordLookupPanel } from "./WordLookup";

export function WordPopup({
  word,
  position,
  sourceDocId,
  context,
  onClose,
}: {
  word: string;
  position: { x: number; y: number };
  sourceDocId: number | null;
  context?: string;
  onClose: () => void;
}) {
  // Pops the dictionary out into its own persistent OS window (Phase 6) —
  // focuses it if already open, otherwise creates it seeded with the
  // current word via URL params (avoids a race with the new window's event
  // listener not being mounted yet for the very first lookup).
  async function handleDetach() {
    const existing = await WebviewWindow.getByLabel("dictionary");
    if (existing) {
      await emit("word-selected", { word, context: context ?? null, sourceDocId });
      await existing.setFocus();
    } else {
      const params = new URLSearchParams({ panel: "dictionary", word });
      if (context) params.set("context", context);
      if (sourceDocId != null) params.set("docId", String(sourceDocId));
      new WebviewWindow("dictionary", {
        url: `/?${params.toString()}`,
        title: "Dictionary",
        width: 340,
        height: 520,
      });
    }
    onClose();
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
        <WordLookupPanel
          word={word}
          sourceDocId={sourceDocId}
          context={context}
          headerActions={
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={handleDetach}
                title="Open in a separate window"
                aria-label="Detach dictionary to new window"
                className="text-gray-400 hover:text-gray-600"
              >
                ⇱
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
          }
        />
      </div>
    </>
  );
}
