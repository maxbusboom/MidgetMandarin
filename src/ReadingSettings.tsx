import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ReadingSettings {
  font_family: "sans" | "serif";
  font_size: number;
  line_height: number;
}

const DEFAULT_SETTINGS: ReadingSettings = { font_family: "sans", font_size: 18, line_height: 1.8 };

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 28;
const FONT_SIZE_STEP = 2;
const LINE_HEIGHT_MIN = 1.4;
const LINE_HEIGHT_MAX = 2.4;
const LINE_HEIGHT_STEP = 0.2;

export function fontFamilyFor(charSet: "simplified" | "traditional", family: "sans" | "serif"): string {
  const base = family === "serif" ? "Noto Serif" : "Noto Sans";
  return `${base} ${charSet === "simplified" ? "SC" : "TC"}`;
}

// Loads once on mount and persists every change via set_reading_settings —
// these are app-wide preferences (like Kindle/Apple Books), not per-document.
export function useReadingSettings() {
  const [settings, setSettings] = useState<ReadingSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    invoke<ReadingSettings>("get_reading_settings")
      .then(setSettings)
      .catch(() => {});
  }, []);

  function update(partial: Partial<ReadingSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      invoke("set_reading_settings", { settings: next }).catch(() => {});
      return next;
    });
  }

  return { settings, update };
}

export function ReadingSettingsPopover({
  settings,
  onChange,
  onClose,
}: {
  settings: ReadingSettings;
  onChange: (partial: Partial<ReadingSettings>) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-10 z-50 w-64 rounded-lg border border-gray-200 bg-white p-4 shadow-lg">
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-gray-500">Font</div>
          <div className="flex gap-1">
            <button
              onClick={() => onChange({ font_family: "sans" })}
              className={`flex-1 rounded px-2 py-1 text-sm ${
                settings.font_family === "sans" ? "bg-blue-600 text-white" : "bg-gray-100"
              }`}
            >
              Sans
            </button>
            <button
              onClick={() => onChange({ font_family: "serif" })}
              className={`flex-1 rounded px-2 py-1 text-sm ${
                settings.font_family === "serif" ? "bg-blue-600 text-white" : "bg-gray-100"
              }`}
            >
              Serif
            </button>
          </div>
        </div>

        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-gray-500">Font size</div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => onChange({ font_size: Math.max(FONT_SIZE_MIN, settings.font_size - FONT_SIZE_STEP) })}
              disabled={settings.font_size <= FONT_SIZE_MIN}
              className="rounded bg-gray-100 px-3 py-1 disabled:opacity-40"
            >
              A−
            </button>
            <span className="text-sm text-gray-600">{settings.font_size}px</span>
            <button
              onClick={() => onChange({ font_size: Math.min(FONT_SIZE_MAX, settings.font_size + FONT_SIZE_STEP) })}
              disabled={settings.font_size >= FONT_SIZE_MAX}
              className="rounded bg-gray-100 px-3 py-1 disabled:opacity-40"
            >
              A+
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-gray-500">Line spacing</div>
          <div className="flex items-center justify-between">
            <button
              onClick={() =>
                onChange({ line_height: Math.max(LINE_HEIGHT_MIN, +(settings.line_height - LINE_HEIGHT_STEP).toFixed(1)) })
              }
              disabled={settings.line_height <= LINE_HEIGHT_MIN}
              className="rounded bg-gray-100 px-3 py-1 disabled:opacity-40"
            >
              −
            </button>
            <span className="text-sm text-gray-600">{settings.line_height.toFixed(1)}</span>
            <button
              onClick={() =>
                onChange({ line_height: Math.min(LINE_HEIGHT_MAX, +(settings.line_height + LINE_HEIGHT_STEP).toFixed(1)) })
              }
              disabled={settings.line_height >= LINE_HEIGHT_MAX}
              className="rounded bg-gray-100 px-3 py-1 disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
