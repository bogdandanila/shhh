# 🤫 shhh

**Privacy-first hold-to-talk dictation for macOS.**

Hold a key, speak, release — your words appear in whatever app you're typing in, cleaned up and punctuated. Like Superwhisper or Wispr Flow, except everything stays on your machine, you bring your own API keys, and you can read every line of code that touches your audio.

## How it works

1. **Hold right ⌘** anywhere on your Mac and speak. A small overlay shows that shhh is listening (up to 10 minutes per dictation, configurable).
2. Release the key. Your speech is transcribed — **locally via Whisper** (nothing leaves your Mac) or via a cloud STT provider of your choice (OpenAI, Groq, Deepgram) with **your own API key**.
3. Optionally, an LLM pass (Anthropic or OpenAI, your key) strips filler words ("uhm…"), fixes punctuation, and tidies sentences.
4. The result is pasted into the focused input of whatever app you're in. Your previous clipboard contents are restored.

A 🤫 icon in the menu bar gives you dictation history (searchable, click-to-copy), settings, and quit.

## Privacy & security

- **Local-first**: with local Whisper, audio never leaves your Mac. Audio lives only in memory and is zeroed after transcription — never written to disk.
- **Your keys, your prompts**: all providers are opt-in with your own API keys. The LLM system prompt is fully editable. No accounts, no telemetry, no middleman servers — cloud calls (if you opt in) go directly from your Mac to the provider.
- **Encrypted at rest**: dictation history is stored in a SQLCipher (AES-256) database; the database key is protected by the macOS Keychain. API keys are individual Keychain items, never stored in the database or logs.
- **Nothing is used for training**: there's no backend. What providers do is governed by your own agreement with them (both Anthropic and OpenAI APIs don't train on API traffic by default).
- `shhh nuke` wipes everything: history, settings, keys.

## Install

> **Note:** shhh is currently unsigned (no Apple Developer certificate). Files downloaded with a **browser** are quarantined and macOS will refuse to open the app without a trip through System Settings. Downloading with `curl` (below) avoids the quarantine flag entirely — that's why the instructions look like this.

**1. Download and verify** (Terminal):

```sh
curl -L -o /tmp/shhh.zip \
  https://github.com/bogdandanila/shhh/releases/latest/download/shhh-0.1.0-universal-mac.zip
curl -sL https://github.com/bogdandanila/shhh/releases/latest/download/checksums.txt
shasum -a 256 /tmp/shhh.zip   # must match the line printed above
```

**2. Install and launch:**

```sh
ditto -xk /tmp/shhh.zip /Applications
open /Applications/shhh.app
```

**3. First-run setup** — a setup window opens automatically:

1. **Permissions** — grant Microphone (system prompt), then Input Monitoring and Accessibility (buttons open the right System Settings panes; toggle shhh on). Press any key to verify Input Monitoring — if the checkbox stays unchecked, hit *Restart shhh* once.
2. **Speech-to-text** — pick **Local Whisper** (recommended: `base.en`, a 142 MB one-time download, fully offline) or a cloud provider with your API key.
3. **Formatting** *(optional)* — add an Anthropic or OpenAI key to get filler-word removal and punctuation cleanup. Skip it and shhh pastes raw transcriptions.

**4. Dictate:** put your cursor in any text field, **hold right ⌘**, speak, release. Done.

If the app ever feels stuck: the 🤫 menu-bar icon has Settings and Quit, and the setup window can always be reopened from there.

### Updating

Repeat the download/install steps with the new version's zip. macOS resets permission grants for unsigned apps on update, so the setup window will reopen — re-toggle Input Monitoring and Accessibility, ~30 seconds.

## CLI (optional, power users)

The app is fully controllable from a CLI — change models, hotkey, prompts, retention, inspect history. It's not yet published to npm; for now, run it from a source checkout:

```sh
git clone https://github.com/bogdandanila/shhh && cd shhh
npm ci && npm run build
node dist/cli/index.js --help
```

Highlights:

```sh
shhh status                        # what's configured, is the app running
shhh doctor                        # permission + config health check
shhh config set hotkey ralt        # rcmd (default), lcmd, ralt, lalt, … or a raw keycode
shhh config set max-recording 10m  # dictation safety cap
shhh model download base.en        # fetch a local Whisper model (sha256-verified)
shhh prompt edit                   # customize the formatting system prompt
shhh history list / search / copy  # dictation history from the terminal
shhh nuke                          # wipe history, settings, and keys
```

API keys are entered via hidden prompt (`shhh config set anthropic.api-key`) — never as command-line arguments, so they can't leak into shell history.

## Requirements

- macOS 13+ (Apple Silicon or Intel — the build is universal)
- For local transcription: ~150 MB disk for a Whisper model; Apple Silicon recommended for speed
- For cloud STT / formatting: your own API key(s)

## Development

```sh
npm ci
npm test                 # vitest unit suite (node ABI)
npm run rebuild:electron # switch native modules to Electron ABI
npx electron .           # run the app from source
SHHH_KEY_DEBUG=1 npx electron .  # log keycodes (for picking a custom hotkey)
```

Native modules can only target one ABI at a time: `npm run rebuild:node` before `npm test`, `npm run rebuild:electron` before running/packaging the app.
