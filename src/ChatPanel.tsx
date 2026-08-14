import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatPanel({
  docId,
  onClose,
  standalone,
}: {
  docId: number;
  onClose: () => void;
  // Rendered as its own detached window (Phase 6) rather than an embedded
  // right-side drawer — fills the window instead of floating over it, and
  // has no close button since the OS window chrome does that job.
  standalone?: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError("");
    try {
      const reply = await invoke<string>("ai_chat", { docId, messages: next });
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={
        standalone
          ? "flex h-screen w-screen flex-col bg-white"
          : "fixed right-0 top-0 bottom-0 z-40 flex w-96 flex-col border-l border-gray-200 bg-white shadow-lg"
      }
    >
      <div className="flex items-center justify-between border-b border-gray-200 p-3">
        <h2 className="font-semibold">Chat about this document</h2>
        {!standalone && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && <p className="text-sm text-gray-400">Ask a question about this document.</p>}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-lg px-3 py-2 text-sm ${
              m.role === "user" ? "ml-6 bg-blue-600 text-white" : "mr-6 bg-gray-100 text-gray-900"
            }`}
          >
            {m.content}
          </div>
        ))}
        {sending && <p className="text-sm text-gray-400">Thinking…</p>}
      </div>

      {error && <div className="border-t border-gray-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

      <div className="flex gap-2 border-t border-gray-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask a question…"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          onClick={handleSend}
          disabled={sending}
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
