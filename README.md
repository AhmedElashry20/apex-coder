# APEX Coder

A fully local AI agent for macOS. It lives in the menu bar, talks to local models through Ollama, runs code, searches the web, remembers past work, and can listen and speak — including a meeting mode — without sending anything to a hosted API.

![Platform](https://img.shields.io/badge/platform-macOS-000000?style=flat-square&logo=apple)
![Electron](https://img.shields.io/badge/Electron-31-47848F?style=flat-square&logo=electron&logoColor=white)
![Ollama](https://img.shields.io/badge/LLM-Ollama_(local)-222222?style=flat-square)
![Python](https://img.shields.io/badge/voice-Python_3.11-3776AB?style=flat-square&logo=python&logoColor=white)

## What it does

| Area | How |
|---|---|
| **Chat & coding** | Local models via Ollama (`qwen2.5-coder` 14B / 7B, `qwen2.5` 14B) |
| **Code execution** | Runs snippets across web, shell, compiled, JVM, .NET and Apple toolchains (`src/executor.js`) |
| **Web research** | DuckDuckGo search, page fetch and content extraction, GitHub lookups (`src/search.js`, `src/browser.js`) |
| **Memory** | SQLite store with `nomic-embed-text` embeddings and cosine-similarity recall (`src/memory.js`) |
| **Voice in** | Speech-to-text with faster-whisper, Arabic and English question detection (`src/voice/whisper_listener.py`) |
| **Voice out** | XTTS v2 text-to-speech, multilingual including Arabic (`src/voice/tts_speaker.py`) |
| **Voice cloning** | RVC model trained from your own samples after noise reduction and filtering (`src/voice/rvc_cloner.py`) |
| **Meeting mode** | Routes audio through BlackHole so the agent can follow and answer in a call (`src/voice/meeting_mode.py`) |
| **Tech digest** | Weekly summaries of tracked technologies saved to memory (`src/updater.js`) |
| **Security checks** | Authorized, defensive checks on your own Mac (`src/security.js`) |

## Requirements

- macOS (Apple silicon or Intel)
- Homebrew, Python 3.11, Node.js
- [Ollama](https://ollama.com) and the [BlackHole 2ch](https://github.com/ExistentialAudio/BlackHole) audio driver (meeting mode)

`setup.sh` installs all of these with Homebrew and pulls the models.

## Run it

```bash
bash setup.sh     # one-time: dependencies, Python env, Ollama models
npm install
npm start         # launches the menu-bar app
```

Build a DMG:

```bash
npm run build
```

## Project layout

```
src/
├── main.js          Electron main process, tray / menu-bar window
├── preload.js       Bridge for chat, code execution, browser, memory, voice
├── ollama.js        Local model client (chat + embeddings)
├── executor.js      Multi-language code runner
├── search.js        Web and GitHub search
├── browser.js       Page fetch and content extraction
├── memory.js        SQLite + embeddings memory
├── updater.js       Weekly tech digest
├── security.js      Defensive security checks
└── voice/           Whisper listener, XTTS speaker, RVC cloner, meeting mode
```

---

Built by [Ahmed Elashry](https://ahmedelashry20.github.io/portfolio/).
