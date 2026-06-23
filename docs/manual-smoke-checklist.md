# shhh — Release Candidate Smoke Checklist

Run on a real Mac before tagging a release. Items 1–6 are also the Task 15 verification.

1. **First-run setup**: delete `~/Library/Application Support/shhh`, launch app → home window opens on **Settings**; Microphone + Accessibility grant live (checkboxes flip without restarting); STT downloadable; window switches to Home once permissions + STT are ready.
2. **Hotkey (fn)**: `SHHH_KEY_DEBUG=1` launch → holding fn logs `flags 63`; hold-to-talk works; quick tap leaves the system globe action intact; no double-fires.
3. **Configure via UI/CLI**: Settings → Speech-to-text downloads a local model (progress bar) or saves a cloud key; `shhh doctor` all green. (CLI still works against the same store.)
4. **Dictation into TextEdit**: hold-speak-release → listening overlay (with timer) → processing → correct text pasted; previous clipboard contents restored.
5. **Home window access**: with the app running, re-launch shhh from Spotlight → window comes to the front even if the tray icon is hidden under the notch. Tray → Open shhh / History / Settings / Check for Updates each open the right section. Closing the window keeps dictation working; Quit (Home button or tray) exits.
6. **History view**: Home window → History → entries present; click-to-copy works; search filters; overlay click also opens History.
7. **Formatting pass**: with Anthropic key set, filler words removed; with key removed (`shhh nuke` then re-setup), raw text still pastes (unformatted fallback).
8. **Paste targets**: dictate into (a) Chrome textarea, (b) Terminal, (c) Slack, (d) VS Code. All receive text; clipboard restored.
9. **Fullscreen**: overlay visible over a fullscreen app.
10. **Secure input**: dictate into a password field → overlay shows "Copied — press ⌘V"; text on clipboard.
11. **Long dictation**: set `max-recording 1m`, talk past the cap → warning pulse at 30s remaining, graceful stop, full text processed.
12. **Errors**: unset STT (`shhh nuke`) → dictation shows actionable error overlay. Bad API key → error mentions failure, nothing pasted.
13. **Permission revocation**: revoke Accessibility in System Settings → hotkey stops; re-grant → works again without app restart; `shhh doctor` reflects it.
14. **Live hotkey change**: Settings → Preferences → change Hotkey → hold the new key → dictation triggers without restarting the app.
15. **Preferences persistence**: toggle Duck audio and Launch at login; reopen the window → values stuck; reboot → app auto-launches if Launch at login was on.
16. **Install flow** (post-release): `npm i -g` the CLI tarball, `shhh install` downloads, verifies checksum, app launches from /Applications without Gatekeeper dialog.
17. **Update flow**: `shhh update` (or Home → Check for Updates) → app replaced → home window re-opens on Settings for the Accessibility re-grant.

## Audio ducking

- [ ] Play music. Hold fn — system volume drops to ~20. Release — volume returns to the previous level while transcription is still running.
- [ ] Quick-tap fn (<300ms) while music plays — volume returns (no stuck duck).
- [ ] Mute output, hold fn — volume/mute untouched on release.
- [ ] `shhh config set duck-audio off`, hold fn — volume untouched. Set back `on`.

## Check for Updates

- [ ] On the latest released version: tray → Check for Updates… — "You're up to date (latest release: X, you have Y)" dialog, brought to the front.
- [ ] Dev build (`npm start`) with a newer release published: dialog says updating requires the installed build; nothing is modified.
- [ ] Installed build with a newer release published: Install and Relaunch downloads, swaps `/Applications/shhh.app`, relaunches on the new version (Setup may reopen for the Accessibility re-grant — expected with ad-hoc signing).
- [ ] Double-click Check for Updates… rapidly — only one dialog appears (reentrancy guard).
