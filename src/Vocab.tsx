import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";

interface VocabEntry {
  id: number;
  simplified: string;
  traditional: string;
  pinyin: string;
  definition: string;
  added_at: string;
}

export function Vocab({ onBack }: { onBack: () => void }) {
  const [entries, setEntries] = useState<VocabEntry[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  async function refresh() {
    try {
      setEntries(await invoke<VocabEntry[]>("list_vocab"));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
    // Vocab can also be added/removed from a detached dictionary window or
    // the inline WordPopup (Phase 6) — stay live rather than going stale.
    const unlisten = listen("vocab-changed", () => refresh());
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  async function handleRemove(entry: VocabEntry) {
    const ok = await confirm(`Remove "${entry.simplified}" from your vocabulary?`, {
      title: "Remove word",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await invoke("remove_vocab", { id: entry.id });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleExport() {
    setError("");
    setStatus("");
    setExporting(true);
    try {
      const path = await invoke<string>("export_vocab_to_anki");
      setStatus(`Exported to ${path}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="w-full p-6">
      <div className="mb-6 flex items-center justify-between">
        <button onClick={onBack} className="text-blue-600 hover:underline">
          ← Library
        </button>
        <h1 className="text-2xl font-semibold">My Vocabulary</h1>
        <button
          onClick={handleExport}
          disabled={exporting || entries.length === 0}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export to Anki"}
        </button>
      </div>

      {status && <div className="mb-4 rounded bg-green-100 px-3 py-2 text-sm text-green-800">{status}</div>}
      {error && <div className="mb-4 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</div>}

      {entries.length === 0 ? (
        <p className="text-gray-500">No words saved yet — click a word in a document to add it.</p>
      ) : (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 p-3"
            >
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="font-zh-simplified text-lg font-semibold">{entry.simplified}</span>
                  {entry.traditional !== entry.simplified && (
                    <span className="font-zh-traditional text-gray-400">{entry.traditional}</span>
                  )}
                  <span className="text-sm text-gray-500">{entry.pinyin}</span>
                </div>
                <p className="text-sm text-gray-700">{entry.definition}</p>
              </div>
              <button
                onClick={() => handleRemove(entry)}
                className="shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-100 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
