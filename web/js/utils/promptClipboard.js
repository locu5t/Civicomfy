const DEFAULT_SEPARATOR = "newline";

export const CLIPBOARD_SEPARATOR_OPTIONS = [
  { value: "newline", label: "New line" },
  { value: "comma", label: "Comma" },
  { value: "semicolon", label: "Semicolon" },
  { value: "pipe", label: "Pipe" },
];

function getSeparatorPattern(key = DEFAULT_SEPARATOR) {
  switch (key) {
    case "comma":
      return /[,\n]+/;
    case "semicolon":
      return /[;\n]+/;
    case "pipe":
      return /[|\n]+/;
    case "newline":
    default:
      return /\r?\n+/;
  }
}

export function coerceSeparator(value) {
  if (CLIPBOARD_SEPARATOR_OPTIONS.some((opt) => opt.value === value)) {
    return value;
  }
  return DEFAULT_SEPARATOR;
}

export function sanitizePromptItems(values, limit = 256) {
  if (values == null) return [];
  const list = Array.isArray(values) ? values : [values];
  const maxItems = typeof limit === "number" && limit > 0 ? limit : 256;
  const result = [];
  const seen = new Set();
  for (const raw of list) {
    if (raw == null) continue;
    let text = String(raw).replace(/\r/g, "").trim();
    if (!text) continue;
    if (text.length > 120) {
      text = text.slice(0, 120).trim();
    }
    const lowered = text.toLocaleLowerCase();
    if (seen.has(lowered)) continue;
    seen.add(lowered);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function parsePromptText(text, separator = DEFAULT_SEPARATOR) {
  if (typeof text !== "string") return [];
  const pattern = getSeparatorPattern(separator);
  const pieces = text
    .replace(/\r/g, "")
    .split(pattern)
    .map((part) => part.trim())
    .filter(Boolean);
  return sanitizePromptItems(pieces, 256);
}

export function reorderItems(items, fromIndex, toIndex) {
  if (!Array.isArray(items)) return [];
  const list = items.slice();
  const total = list.length;
  if (total === 0) return [];
  let from = Number(fromIndex);
  let to = Number(toIndex);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return list;
  if (from < 0 || from >= total) return list;
  if (to < 0) to = 0;
  if (to >= total) to = total - 1;
  if (from === to) return list;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}

export function formatPromptItems(items, separator = DEFAULT_SEPARATOR) {
  const sanitized = sanitizePromptItems(items, 256);
  if (sanitized.length === 0) return "";
  switch (separator) {
    case "comma":
      return sanitized.join(", ");
    case "semicolon":
      return sanitized.join("; ");
    case "pipe":
      return sanitized.join(" | ");
    case "newline":
    default:
      return sanitized.join("\n");
  }
}

export function generatePromptGroupId(prefix = "pg") {
  const base =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const trimmedPrefix = String(prefix || "pg").replace(/[^a-z0-9_-]/gi, "").slice(0, 16) || "pg";
  const id = `${trimmedPrefix}-${base}`;
  return id.slice(0, 80);
}

export { DEFAULT_SEPARATOR };
