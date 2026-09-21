# Jev Chat

**Drop in a document, ask questions, get answers with probabilities — on Windows and Android.**

Jev Chat is a chat-style app for **Jev**, TypeSafe AI's typed decision model, running through **Vercel AI Gateway**.
Unlike a chatbot, Jev doesn't write paragraphs. It gives you a decision — and tells you how sure it is.

| Example question | Example answer |
|---|---|
| "Does this contract allow early termination?" | **Yes** — 94% |
| "What is the tone of this review?" | **Mixed** — positive 12%, mixed 84%, negative 4% |
| "How urgent is this support ticket?" | **High** — low 2%, medium 10%, high 88% |

> Unofficial, community-made app. Not affiliated with TypeSafe AI or Vercel.

## Why Jev Chat

**📚 Reads whole books, not just snippets.**
Jev accepts about 32,000 tokens per call. Jev Chat splits long documents automatically and merges the answers, so you can load a full novel or dissertation (up to 400,000 characters). In our test, it found a single sentence hidden near the end of a 130,000-character document with 98% confidence.

**📄 Works with the files you actually have.**
Text, PDF, Word (`.docx`) and images. Scanned PDFs and photos are converted with on-device OCR. PDFs with Japanese/CJK fonts are handled correctly thanks to the bundled font maps.

**🎯 Answers you can act on.**
Every answer comes with a probability for each option, so you can see when Jev is confident and when it is guessing. Ask many questions at once — one per line — and get them all back in one pass.

**🔒 Private by design.**
Your API key never leaves your device except to go to Vercel. OCR runs locally, so images are never uploaded. On Windows, the local server listens on `127.0.0.1` only.

**💸 No surprise bills.**
The app shows the actual cost reported by Vercel and your remaining free credits, and it stops sending before you would be charged. Jev's list price at the time of writing is $0.042 per million input tokens, with free output.

**📱 Same app, two platforms.**
The Windows and Android apps share the same interface. The Android app talks to Vercel directly — no PC needed.

## Before you start: get your own API key

The app uses **your own** Vercel AI Gateway API key. Usage is billed to your own Vercel account.

1. Create an account at [vercel.com](https://vercel.com/signup).
2. Open **AI Gateway → API Keys → Create Key**. The key is shown only once, so save it.
3. Free credits require adding a card. Adding a card alone does not charge you. Charges happen only if you buy credits or turn on auto top-up.
4. Recommended: set a spending limit under **AI Gateway → Budgets** (for example $5).

On first launch the app asks for the key and stores it on your device only.

## Platforms at a glance

| | Windows | Android |
|---|---|---|
| Runs on | Windows 10 / 11 | Android 7.0+ |
| Needs a PC to work | — | No |
| OCR engine | Windows OCR (built in) | Google ML Kit (bundled, on-device) |
| Scanned PDFs | Rendered by Windows | Rendered by Android |
| Disk space | **About 60 MB** (+ Node.js, about 100 MB, if not installed yet) | **About 50 MB** |

### App size in detail

Measured with version 1.0:

| | Size | What it is |
|---|---|---|
| **Windows** — download (`git clone`) | 0.2 MB | Source code only |
| **Windows** — after `npm install` | 59 MB | Vercel AI SDK and its dependencies (≈ 18 MB) and pdf.js (≈ 37 MB, of which 3.7 MB is actually used by the app) |
| **Windows** — Node.js | ≈ 100 MB | Only if you don't have Node.js 22+ already |
| **Android** — APK download | 50 MB | Most of it is the on-device text-recognition model |
| **Android** — installed | 49 MB + under 1 MB of data | Grows only with your conversation history |

Microsoft Edge (used as the app window on Windows) and Windows OCR are part of Windows, so they add nothing.

## Windows

**Requirements:** Windows 10 or 11, [Node.js](https://nodejs.org/) 22 or later, Microsoft Edge (preinstalled).

```bash
git clone https://github.com/Manta-Boardgame/jev-chat.git
cd jev-chat
npm install
```

Then double-click **`JevChat.bat`**. The app opens in its own window. Close the window to quit; the background server stops by itself a few minutes later.

You can also run `npm start` and open http://localhost:3939.

- If image text recognition fails, add an OCR-capable language under **Settings → Time & language → Language & region**.
- To share the app with people who don't have Node.js, put `node.exe` in a `runtime` folder next to `JevChat.bat`. The launcher uses it automatically.

## Android

**Requirements:** Android 7.0 or later to run it; Android Studio (or JDK 17 + Android SDK 36) to build it.

```bash
npm install            # copies the page and pdf.js into the Android assets
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
Install it with `adb install`, or copy it to your phone and open it.

## How to get the best answers

- **Load only what matters.** For long files, the relevant pages give sharper answers than the whole document, because answers from split parts are averaged (choice / scale) or maxed (yes / no).
- **Put the options in the question type, not the question.** Choose "Multiple choice" and list the options (for example `A, B, C, D`), then ask "Which option is correct for question 3?".
- **Ask several related questions at once.** One per line; they are answered in a single call.

## Limitations

- Jev reads **text only**. Images and scanned PDFs are converted to text with OCR first.
- Jev judges based on the text you provide. It cannot answer knowledge questions whose answer is not in the text.
- If Jev cannot separate the options for a question, that question is reported as "no answer" and the others still come back.

## Project structure

```
server.mjs                  Local server for Windows (serves the page, calls Jev, runs OCR)
public/index.html           The chat UI, shared by Windows and Android
scripts/copy-vendor.mjs     Copies pdf.js into public/vendor and the Android assets (runs on npm install)
scripts/windows/            PowerShell helpers for Windows OCR and PDF rendering
launcher.vbs, JevChat.bat   Windows launcher (no console window)
android/                    Android app (WebView + native bridge for networking, OCR and PDF rendering)
```

## Privacy

- Your API key stays on your device and is sent only to Vercel AI Gateway.
- The text of the files you load is sent to Jev through Vercel together with your questions.
- OCR runs locally; images themselves are not uploaded.
- Conversation history is stored only on your device.

## Acknowledgements

- [Vercel AI SDK](https://github.com/vercel/ai) and [AI Gateway](https://vercel.com/ai-gateway)
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache License 2.0)
- [Google ML Kit Text Recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2)
