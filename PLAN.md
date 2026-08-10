# Midget Mandarin — Project Plan & VS Code Development Guide

This document is the working basis for building Midget Mandarin: what it is, the architecture, the build order, and exactly how the project is set up and run inside VS Code. Keep it in the repo root as `PLAN.md` and update it as decisions change.

---

## 1. What we're building

A desktop app: user loads a Mandarin-Chinese PDF, the app extracts the text and re-renders it in one consistent, easy-to-read font, faintly highlights nouns/verbs/adjectives, and lets the user build a personal dictionary by clicking unknown words (Pleco-style popup), export that vocab to Anki, and optionally chat with an AI about the document using their own API key. No accounts, everything stored locally.

| Area | Requirement |
|---|---|
| Input | Mandarin-Chinese PDF |
| Rendering | Extracted text reflowed into one consistent bundled font — not the PDF's original layout |
| Highlighting | Nouns/verbs/adjectives faintly highlighted; everything else renders plain |
| Dictionary | Click unknown word → add to personal dictionary; click a saved word → dictionary popup; scrollable vocab list |
| Anki export | Personal vocab → `.apkg` |
| AI (optional, BYOK) | Chat about the document; "use word in a sentence"; Q&A scoped to text in the current context window |
| Library | Grid of imported PDFs — icon + filename |
| Privacy | No accounts, all local, AI is opt-in with the user's own key |

This is a cross-platform **desktop app**, not web or mobile — driven by "no accounts / all local," the PDF library, and multi-window behavior (detachable dictionary/chat panels).

---

## 2. Architecture

| Layer | Choice | Why |
|---|---|---|
| **Shell** | Tauri v2 | Native OS webview instead of bundled Chromium → small install size, low idle memory (this app is meant to sit open all day). Rust core with capability-based permissions. Built-in multi-window API covers the detachable dictionary/chat panels. |
| **Frontend** | React (or Svelte) + Tailwind, inside the Tauri webview | Standard web tooling; runs in the native webview Tauri provides. |
| **Font** | Bundled CJK font (Noto Sans/Serif SC/TC as a safe default, or LXGW WenKai for a more book-like feel) | Guarantees the "consistent font" requirement actually holds across Windows/macOS/Linux instead of depending on whatever's installed. |
| **NLP backend** | Python sidecar process (Tauri sidecar, local IPC/HTTP only) | jieba as the fast default segmenter/POS tagger; spaCy + pkuseg as a more accurate swap-in for highlighting; the user's own AI key as a fallback tagger for low-confidence spans (poetry, classical Chinese) — optional, never required for core reading. |
| **PDF extraction** | PyMuPDF (`fitz`) | Solid CJK text extraction with reading order, which a reflow view needs. |
| **Dictionary data** | CC-CEDICT → local SQLite | CC BY-SA licensed — requires attribution in-app; share-alike only applies if you modify the dictionary data itself. |
| **Local storage** | SQLite (library metadata, personal vocab, settings) + a local app-data folder for the PDFs themselves | No server, no sync — matches the no-accounts requirement. |
| **Anki export** | `genanki` (Python), run in the sidecar | Straight from the vocab table to `.apkg`. |
| **AI integration** | BYOK, key in OS keychain via a Tauri secure-storage plugin, provider calls behind a thin interface | Never stored in plaintext, never sent anywhere but the configured provider; a visible toggle keeps it optional. |

---

## 3. Phased roadmap

| Phase | Deliverable | Rough effort |
|---|---|---|
| 0 — Foundation | Tauri + frontend scaffold; Python sidecar wired up over local IPC; SQLite schema | 1–2 wks |
| 1 — Reader MVP | PDF import → PyMuPDF extraction → reflowed text in bundled font; library grid view | 2 wks |
| 2 — Segmentation & highlighting | jieba integration; noun/verb/adjective faint highlight | 1–2 wks |
| 3 — Dictionary | CC-CEDICT → SQLite; click-word popup; personal vocab panel | 2 wks |
| 4 — Anki export | genanki integration; export flow | 3–5 days |
| 5 — AI features | Key management UI; chat panel; "use in a sentence"; AI-assisted segmentation fallback | 2–3 wks |
| 6 — Multi-window polish | Detachable dictionary/chat windows; shared state sync | 1 wk |
| 7 — POS accuracy pass | spaCy + pkuseg swap-in; tune highlight thresholds | 1 wk |
| 8 — Packaging & privacy pass | Code signing/notarization, installers, CC-CEDICT attribution surfaced in-app, verify no stray network calls when AI is off | 1–2 wks |

Phases 0–4 alone produce a genuinely usable reader; AI and multi-window are additive on top.

**Open decisions to pin down before Phase 0:** simplified/traditional/both, which AI provider(s) at launch, free vs. paid distribution, whether scanned/image-only PDFs are in scope for v1 (OCR is a materially bigger lift than text-layer PDFs).

---

## 4. Project structure

```
midget-mandarin/
├── .vscode/
│   ├── settings.json
│   ├── tasks.json
│   ├── launch.json
│   └── extensions.json
├── src/                     # frontend (React/Svelte + Tailwind)
├── src-tauri/               # Rust core: tauri.conf.json, Cargo.toml, commands
├── sidecar/                 # Python NLP service
│   ├── main.py
│   └── requirements.txt
├── data/
│   └── cedict/              # CC-CEDICT source dump + build script → SQLite
├── package.json
└── PLAN.md                  # this file
```

---

## 5. VS Code setup

### 5.1 Open the project

File → Open Folder → the `midget-mandarin/` root. If frontend/sidecar ever get split into separate repos, use a `.code-workspace` file to open them together as one multi-root workspace instead.

### 5.2 Extensions

Create `.vscode/extensions.json` so VS Code prompts anyone opening the repo to install the right set:

```json
{
  "recommendations": [
    "rust-lang.rust-analyzer",
    "tauri-apps.tauri-vscode",
    "ms-python.python",
    "ms-python.vscode-pylance",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "qwtel.sqlite-viewer"
  ]
}
```

- **rust-analyzer** — the Tauri/Rust core in `src-tauri/`
- **Tauri** (official extension) — schema/autocomplete for `tauri.conf.json`, command scaffolding
- **Python + Pylance** — the NLP sidecar
- **ESLint/Prettier** — frontend
- **SQLite Viewer** — inspect the library/vocab/dictionary DB directly from the editor

### 5.3 `.vscode/settings.json`

```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/sidecar/.venv/bin/python",
  "rust-analyzer.linkedProjects": ["src-tauri/Cargo.toml"],
  "files.watcherExclude": {
    "**/target/**": true,
    "**/node_modules/**": true,
    "**/data/library/**": true,
    "**/*.sqlite": true
  },
  "search.exclude": {
    "**/target": true,
    "**/node_modules": true,
    "**/data/library": true
  }
}
```

The watcher/search excludes matter here specifically because imported PDFs and the CEDICT-derived SQLite file can get large — without this, editor indexing slows down noticeably.

### 5.4 `.vscode/tasks.json`

Lets you launch each part of the stack from the Command Palette (`Run Task`) instead of juggling terminals manually:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "tauri: dev",
      "type": "shell",
      "command": "npm run tauri dev",
      "group": "build",
      "isBackground": true,
      "problemMatcher": []
    },
    {
      "label": "sidecar: run (standalone)",
      "type": "shell",
      "command": "${workspaceFolder}/sidecar/.venv/bin/python sidecar/main.py",
      "group": "build",
      "isBackground": true,
      "problemMatcher": []
    },
    {
      "label": "cedict: rebuild dictionary db",
      "type": "shell",
      "command": "${workspaceFolder}/sidecar/.venv/bin/python data/cedict/build_db.py",
      "group": "build",
      "problemMatcher": []
    }
  ]
}
```

Run "sidecar: run (standalone)" on its own while iterating on segmentation/dictionary logic, so you're not restarting the whole Tauri app every time you change Python code.

### 5.5 `.vscode/launch.json`

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: NLP sidecar",
      "type": "debugpy",
      "request": "launch",
      "program": "${workspaceFolder}/sidecar/main.py",
      "console": "integratedTerminal",
      "justMyCode": true
    },
    {
      "name": "Tauri: debug app",
      "type": "lldb",
      "request": "launch",
      "program": "${workspaceFolder}/src-tauri/target/debug/midget-mandarin",
      "args": [],
      "cwd": "${workspaceFolder}/src-tauri"
    }
  ]
}
```

The Python config lets you set breakpoints directly in jieba/CEDICT lookup code. The Rust config needs the **CodeLLDB** extension installed to work; add it to `extensions.json` once you get to Phase 0's Rust side.

### 5.6 Day-to-day terminal layout

Split the integrated terminal into three panes:
1. `tauri dev` (frontend + Rust core, hot reload)
2. Python sidecar logs
3. Free pane for git / one-off scripts

This mirrors the sidecar architecture directly — backend (segmentation, dictionary, AI calls) and frontend errors stay visually separate.

---

## 6. Risks

- **Segmentation/POS accuracy on hard text** (classical Chinese, poetry, dialect) — mitigated by the jieba → spaCy → AI-fallback ladder rather than depending on one segmenter.
- **CC-CEDICT license compliance** — low risk; needs a visible attribution line, and share-alike only if the dictionary data itself is hand-edited.
- **Font/rendering drift across OSes** — mitigated by bundling the font instead of trusting system fonts.
- **Scope creep from the AI layer** — keep it a clearly optional add-on so the core offline reader never depends on it.

---

## 7. Immediate next steps

1. Confirm the open decisions in §3 (simplified/traditional, AI provider(s), distribution model, scanned-PDF scope).
2. Scaffold the repo structure in §4, add the `.vscode/` files in §5, commit as the initial state.
3. Phase 0: get the Tauri shell talking to the Python sidecar over local IPC — this de-risks the whole architecture before any feature work starts.
4. Pull the CC-CEDICT text dump and get `data/cedict/build_db.py` parsing it into SQLite as a standalone, rerunnable script.
