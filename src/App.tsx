import { useState } from "react";
import { Library } from "./Library";
import { Reader } from "./Reader";
import { Vocab } from "./Vocab";

type View = { kind: "library" } | { kind: "reader"; id: number } | { kind: "vocab" };

function App() {
  const [view, setView] = useState<View>({ kind: "library" });

  if (view.kind === "reader") {
    return <Reader id={view.id} onBack={() => setView({ kind: "library" })} />;
  }
  if (view.kind === "vocab") {
    return <Vocab onBack={() => setView({ kind: "library" })} />;
  }
  return (
    <Library onOpen={(id) => setView({ kind: "reader", id })} onOpenVocab={() => setView({ kind: "vocab" })} />
  );
}

export default App;
