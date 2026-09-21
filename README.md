# Jev Chat

A chat-style app for **Jev**, TypeSafe AI's typed decision model, running through **Vercel AI Gateway**.
Available as a Windows desktop app and an Android app.

Jev does not write text. Instead, it answers questions about the text you give it in one of three typed forms:

- **Yes / No** — with a probability
- **Multiple choice** — picks one of your options, with probabilities for each
- **Rating scale** — picks a level on a scale you define

> This is an unofficial, community-made app. It is not affiliated with TypeSafe AI or Vercel.

## Features

- Ask several questions at once (one question per line)
- Load files: plain text, PDF, Word (`.docx`) and images
- Long documents (novels, dissertations) are split automatically, because Jev accepts about 32,000 tokens per call; the answers are then combined
- Image and scanned-PDF text recognition runs **on your device** (Windows OCR / Google ML Kit); images are never uploaded
- Shows the actual cost reported by Vercel and your remaining free credits
- Stops sending when your free credits or your Vercel budget are used up, so you are never charged by accident

## You need your own API key

The app uses **your own** Vercel AI Gateway API key. Usage is billed to your own Vercel account.

1. Create an account at [vercel.com](https://vercel.com/signup).
2. Open **AI Gateway → API Keys → Create Key**. The key is shown only once, so save it.
3. Free credits require adding a card. Adding a card alone does not charge you. Charges happen only if you buy credits or turn on auto top-up.
4. Recommended: set a spending limit under **AI Gateway → Budgets** (for example $5).

On first launch the app asks for the key. It is stored only on your device (browser storage / app storage) and is sent only to Vercel.

## Windows desktop app

Requirements: Windows 10 or 11, [Node.js](https://nodejs.org/) 22 or later, Microsoft Edge (preinstalled on Windows).

```bash
git clone https://github.com/<your-account>/jev-chat.git
cd jev-chat
npm install
```

Then double-click **`JevChat.bat`**. The app opens in its own window. Close the window to quit; the background server stops by itself a few minutes later.

You can also run it from a terminal with `npm start` and open http://localhost:3939.

Notes:

- The server listens on `127.0.0.1` only, so it cannot be reached from other computers.
- Image OCR uses the built-in Windows OCR engine. If text recognition fails, add an OCR-capable language under **Settings → Time & language → Language & region**.
- To distribute the app without requiring Node.js, copy `node.exe` into a `runtime` folder next to `JevChat.bat`; the launcher uses it automatically.

## Android app

Requirements: Android 7.0 or later to run it; Android Studio (or JDK 17 + Android SDK 36) to build it.

```bash
npm install            # copies the page and pdf.js into the Android assets
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.
Install it with `adb install`, or copy it to your phone and open it.

The APK is about 50 MB because it bundles the on-device text-recognition model.

## Limitations

- Jev reads **text only**. Images and scanned PDFs are converted to text with OCR first.
- Jev judges based on the text you provide. It is good at reading-comprehension style questions, but it cannot answer knowledge questions whose answer is not in the text.
- Very long documents are split into parts. Yes/No uses the highest probability across parts; choice and scale use the average, which can blur the result. For best accuracy, load only the relevant pages.

## Project structure

```
server.mjs              Local server for the desktop app (serves the page, calls Jev, runs OCR)
public/index.html       The chat UI, shared by the desktop and Android apps
scripts/copy-vendor.mjs Copies pdf.js into public/vendor and the Android assets (runs on npm install)
scripts/windows/        PowerShell helpers for Windows OCR and PDF rendering
launcher.vbs, JevChat.bat  Windows launcher (no console window)
android/                Android app (WebView + native bridge for networking, OCR and PDF rendering)
```

## Privacy

- Your API key stays on your device and is sent only to Vercel AI Gateway.
- The text of the files you load is sent to Jev through Vercel together with your questions.
- OCR runs locally; images themselves are not uploaded.
- Conversation history is stored only in the app's local storage on your device.

## Acknowledgements

- [Vercel AI SDK](https://github.com/vercel/ai) and [AI Gateway](https://vercel.com/ai-gateway)
- [pdf.js](https://github.com/mozilla/pdf.js) (Apache License 2.0)
- [Google ML Kit Text Recognition](https://developers.google.com/ml-kit/vision/text-recognition/v2)
