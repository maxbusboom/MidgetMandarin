import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
            <button
              key={entry.id}
              onClick={() => onOpen(entry.id)}
              className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-3 transition-colors hover:border-blue-400 hover:bg-blue-50"
            >
              <PdfIcon />
              <span className="w-full truncate text-center text-sm" title={entry.title}>
                {entry.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
