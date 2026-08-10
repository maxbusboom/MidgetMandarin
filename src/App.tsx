import { useState } from "react";
import { Library } from "./Library";
import { Reader } from "./Reader";

function App() {
  const [openId, setOpenId] = useState<number | null>(null);

  return openId === null ? (
    <Library onOpen={setOpenId} />
  ) : (
    <Reader id={openId} onBack={() => setOpenId(null)} />
  );
}

export default App;
