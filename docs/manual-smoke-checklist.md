# shhh — Release Candidate Smoke Checklist

Run on a real Mac before tagging a release. Items 1–6 are also the Task 15 verification.

1. **First-run setup**: delete `~/Library/Application Support/shhh`, launch app → setup window appears; Microphone + Accessibility grantable, checkboxes flip live without restarting; Done button once permissions + STT complete.
2. **Hotkey (fn)**: `SHHH_KEY_DEBUG=1` launch → holding fn logs `flags 63`; hold-to-talk works; quick tap leaves the system globe action intact; no double-fires.
3. **Configure via CLI**: model download + stt provider set works; `shhh doctor` all green.
4. **Dictation into TextEdit**: hold-speak-release → listening overlay (with timer) → processing → correct text pasted; previous clipboard contents restored.
5. **History panel**: menu-bar 🤫 → History (or click overlay) → entries present; click-to-copy works; search filters; menu-bar Quit stops the app.
6. **Formatting pass**: with Anthropic key set, filler words removed; with key removed (`shhh nuke` then re-setup), raw text still pastes (unformatted fallback).
7. **Paste targets**: dictate into (a) Chrome textarea, (b) Terminal, (c) Slack, (d) VS Code. All receive text; clipboard restored.
8. **Fullscreen**: overlay visible over a fullscreen app.
9. **Secure input**: dictate into a password field → overlay shows "Copied — press ⌘V"; text on clipboard.
10. **Long dictation**: set `max-recording 1m`, talk past the cap → warning pulse at 30s remaining, graceful stop, full text processed.
11. **Errors**: unset STT (`shhh nuke`) → dictation shows actionable error overlay. Bad API key → error mentions failure, nothing pasted.
12. **Permission revocation**: revoke Accessibility in System Settings → hotkey stops; re-grant → works again without app restart; `shhh doctor` reflects it.
13. **Install flow** (post-release): `npm i -g` the CLI tarball, `shhh install` downloads, verifies checksum, app launches from /Applications without Gatekeeper dialog.
14. **Update flow**: `shhh update` → app replaced → setup window re-opens for permission re-grant.

## Audio ducking

- [ ] Play music. Hold fn — system volume drops to ~20. Release — volume returns to the previous level while transcription is still running.
- [ ] Quick-tap fn (<300ms) while music plays — volume returns (no stuck duck).
- [ ] Mute output, hold fn — volume/mute untouched on release.
- [ ] `shhh config set duck-audio off`, hold fn — volume untouched. Set back `on`.
