import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AiSettings {
  enabled: boolean;
  provider: "anthropic" | "openai";
  model: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
};

export function AiSettingsPanel({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<AiSettings>({
    enabled: false,
    provider: "anthropic",
    model: DEFAULT_MODELS.anthropic,
  });
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    invoke<AiSettings>("get_ai_settings")
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    invoke<boolean>("has_api_key", { provider: settings.provider })
      .then(setHasKey)
      .catch(() => {});
  }, [settings.provider]);

  function update(partial: Partial<AiSettings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    invoke("set_ai_settings", { settings: next }).catch((e) => setError(String(e)));
  }

  async function handleSaveKey() {
    if (!apiKey.trim()) return;
    setError("");
    try {
      await invoke("save_api_key", { provider: settings.provider, key: apiKey.trim() });
      setApiKey("");
      setHasKey(true);
      setStatus("API key saved.");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleClearKey() {
    setError("");
    try {
      await invoke("delete_api_key", { provider: settings.provider });
      setHasKey(false);
      setStatus("API key removed.");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="w-full p-6">
      <div className="mb-6 flex items-center justify-between">
        <button onClick={onBack} className="text-blue-600 hover:underline">
          ← Library
        </button>
        <h1 className="text-2xl font-semibold">AI Settings</h1>
        <span className="w-16" />
      </div>

      <div className="max-w-md space-y-6">
        <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
          <div className="pr-4">
            <div className="font-medium">Enable AI features</div>
            <p className="text-sm text-gray-500">
              Chat, "use in a sentence", and segmentation help. Off by default — your key is never sent
              anywhere but the provider you choose below.
            </p>
          </div>
          <button
            onClick={() => update({ enabled: !settings.enabled })}
            aria-label="Toggle AI features"
            className={`h-6 w-11 shrink-0 rounded-full transition-colors ${
              settings.enabled ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                settings.enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Provider</label>
          <div className="flex gap-1">
            <button
              onClick={() => update({ provider: "anthropic", model: DEFAULT_MODELS.anthropic })}
              className={`flex-1 rounded px-3 py-2 text-sm ${
                settings.provider === "anthropic" ? "bg-blue-600 text-white" : "bg-gray-100"
              }`}
            >
              Anthropic
            </button>
            <button
              onClick={() => update({ provider: "openai", model: DEFAULT_MODELS.openai })}
              className={`flex-1 rounded px-3 py-2 text-sm ${
                settings.provider === "openai" ? "bg-blue-600 text-white" : "bg-gray-100"
              }`}
            >
              OpenAI
            </button>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Model</label>
          <input
            value={settings.model}
            onChange={(e) => update({ model: e.target.value })}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">API key</label>
          {hasKey ? (
            <div className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm">
              <span className="text-gray-600">●●●●●●●● saved</span>
              <button onClick={handleClearKey} className="text-red-600 hover:underline">
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`${settings.provider} API key`}
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <button onClick={handleSaveKey} className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
                Save
              </button>
            </div>
          )}
        </div>

        {status && <div className="rounded bg-green-100 px-3 py-2 text-sm text-green-800">{status}</div>}
        {error && <div className="rounded bg-red-100 px-3 py-2 text-sm text-red-800">{error}</div>}
      </div>
    </div>
  );
}
