import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DocumentText {
  title: string;
  character_set: "simplified" | "traditional";
  page_count: number | null;
  extracted_text: string;
}

export function Reader({ id, onBack }: { id: number; onBack: () => void }) {
  const [doc, setDoc] = useState<DocumentText | null>(null);
  const [charSet, setCharSet] = useState<"simplified" | "traditional">("simplified");
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
        <div className="flex gap-2 text-sm">
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
          <div
            className={`whitespace-pre-wrap text-lg leading-relaxed ${
              charSet === "simplified" ? "font-zh-simplified" : "font-zh-traditional"
            }`}
          >
            {doc.extracted_text}
          </div>
        </>
      )}
    </div>
  );
}
