import { useState } from "react";
import { Library } from "./Library";
import { Reader } from "./Reader";
import { Vocab } from "./Vocab";
import { AiSettingsPanel } from "./AiSettings";
import { ChatPanel } from "./ChatPanel";
import { DictionaryWindow } from "./DictionaryWindow";

type View = { kind: "library" } | { kind: "reader"; id: number } | { kind: "vocab" } | { kind: "ai-settings" };

function App() {
  const [view, setView] = useState<View>({ kind: "library" });

  // Detached chat/dictionary popouts (Phase 6) load this same bundle at a
  // distinct URL (see Reader/WordPopup's WebviewWindow calls) — branch on
  // that before falling into the normal single-window view state.
  const params = new URLSearchParams(window.location.search);
  const panel = params.get("panel");
  if (panel === "chat") {
    return <ChatPanel docId={Number(params.get("docId"))} onClose={() => {}} standalone />;
  }
  if (panel === "dictionary") {
    return <DictionaryWindow />;
  }

  if (view.kind === "reader") {
    return <Reader id={view.id} onBack={() => setView({ kind: "library" })} />;
  }
  if (view.kind === "vocab") {
    return <Vocab onBack={() => setView({ kind: "library" })} />;
  }
  if (view.kind === "ai-settings") {
    return <AiSettingsPanel onBack={() => setView({ kind: "library" })} />;
  }
  return (
    <Library
      onOpen={(id) => setView({ kind: "reader", id })}
      onOpenVocab={() => setView({ kind: "vocab" })}
      onOpenAiSettings={() => setView({ kind: "ai-settings" })}
    />
  );
}

export default App;
