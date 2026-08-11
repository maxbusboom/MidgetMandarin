import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";

export interface LibraryEntry {
  id: number;
  filename: string;
  title: string;
  added_at: string;
  page_count: number | null;
  character_set: "simplified" | "traditional";
}

function PdfIcon() {
  return (
    <svg width="40" height="48" viewBox="0 0 40 48" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2h20l12 12v30a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#EF4444" />
      <path d="M24 2v12h12" fill="#FCA5A5" />
      <text x="20" y="31" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">
        PDF
      </text>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z" />
    </svg>
  );
}

export function Library({ onOpen }: { onOpen: (id: number) => void }) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  async function refresh() {
    try {
      setEntries(await invoke<LibraryEntry[]>("list_library"));
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleImport() {
    setImporting(true);
    setError("");
    try {
      await invoke("import_pdf");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(entry: LibraryEntry, e: React.MouseEvent) {
    e.stopPropagation();
    // Browser window.confirm() isn't reliably wired up in Tauri's WKWebView —
    // it silently resolved truthy with no dialog shown in testing. The
    // dialog plugin's confirm() shows a real native OS dialog instead.
    const ok = await confirm(`Remove "${entry.title}" from your library? This cannot be undone.`, {
      title: "Remove from library",
      kind: "warning",
    });
    if (!ok) {
      return;
    }
    setError("");
    try {
      await invoke("delete_document", { id: entry.id });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Library</h1>
        <button
          onClick={handleImport}
          disabled={importing}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {importing ? "Importing…" : "Import PDF"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</div>
      )}

      {entries.length === 0 ? (
        <p className="text-gray-500">No documents yet — import a PDF to get started.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {entries.map((entry) => (
            <div key={entry.id} className="group relative rounded-lg border border-gray-200 transition-colors hover:border-blue-400 hover:bg-blue-50">
              <button
                onClick={() => onOpen(entry.id)}
                className="flex w-full flex-col items-center gap-2 p-3"
              >
                <PdfIcon />
                <span className="w-full truncate text-center text-sm" title={entry.title}>
                  {entry.title}
                </span>
              </button>
              <button
                onClick={(e) => handleDelete(entry, e)}
                title="Remove from library"
                aria-label="Remove from library"
                className="absolute right-1 top-1 rounded p-1 text-gray-400 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
