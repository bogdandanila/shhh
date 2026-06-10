import { execFile } from 'node:child_process';

export interface ClipboardLike { readText(): string; writeText(t: string): void }

const delay300 = () => new Promise<void>((r) => setTimeout(r, 300));

export function synthesizeCmdV(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'],
      (err) => (err ? reject(err) : resolve()));
  });
}

/** Clipboard-swap paste. On failure the text stays on the clipboard (overlay: "Copied — press ⌘V"). */
export async function pasteWithClipboard(
  text: string, clipboard: ClipboardLike,
  keystroke: () => Promise<void> = synthesizeCmdV,
  wait: () => Promise<void> = delay300,
): Promise<boolean> {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  try {
    await keystroke();
    await wait();                 // let the target app read the clipboard
    clipboard.writeText(previous);
    return true;
  } catch {
    return false;                 // keep text on clipboard
  }
}
