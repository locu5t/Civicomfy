export async function copyTextToClipboard(text) {
  const value = typeof text === "string" ? text : String(text ?? "");
  if (!value) return false;
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      console.warn("Clipboard write failed, falling back", error);
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const succeeded = document.execCommand("copy");
    document.body.removeChild(textarea);
    return succeeded;
  } catch (error) {
    console.warn("Legacy clipboard copy failed", error);
    return false;
  }
}

async function tryExecPaste() {
  try {
    const textarea = document.createElement("textarea");
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    const succeeded = document.execCommand && document.execCommand("paste");
    const value = succeeded ? textarea.value : "";
    document.body.removeChild(textarea);
    if (succeeded) return value;
  } catch (error) {
    console.warn("execCommand paste fallback failed", error);
  }
  return "";
}

export async function readTextFromClipboard() {
  if (navigator?.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      if (typeof text === "string") return text;
    } catch (error) {
      console.warn("Clipboard read failed, falling back", error);
    }
  }
  const pasted = await tryExecPaste();
  if (pasted) return pasted;
  const manual = window.prompt("Paste clipboard contents", "");
  return typeof manual === "string" ? manual : "";
}
