let editorId = 0;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (match) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[match] || match);
}

function sanitizeList(values, limit = 512) {
  if (!Array.isArray(values)) return [];
  const cleaned = [];
  const seen = new Set();
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(text);
    if (cleaned.length >= limit) break;
  }
  return cleaned;
}

export function createChipEditor(root, options = {}) {
  if (!root) throw new Error("Chip editor root element is required");
  const {
    title = "Values",
    inputLabel = "Add value",
    placeholder = "Add value and press Enter",
    addAllLabel = "Add all",
    addButtonLabel = "Add",
    helperText = "Press Enter or comma to add."
  } = options;
  const sourceValues = sanitizeList(options.sourceValues || []);
  const inputId = `chip-editor-input-${++editorId}`;
  const titleId = `chip-editor-title-${editorId}`;

  root.classList.add("civitai-chip-editor");
  root.innerHTML = `
    <div class="civitai-chip-editor-header">
      <h4 id="${titleId}" class="civitai-chip-editor-title">${escapeHtml(title)}</h4>
      <div class="civitai-chip-editor-header-actions">
        <button type="button" class="civitai-chip-editor-add-all" aria-describedby="${titleId}">${escapeHtml(addAllLabel)}</button>
      </div>
    </div>
    <div class="civitai-chip-editor-input" role="group" aria-labelledby="${titleId}">
      <label class="civitai-chip-editor-input-label" for="${inputId}">
        <span class="visually-hidden">${escapeHtml(inputLabel)}</span>
      </label>
      <div class="civitai-chip-editor-input-row">
        <input id="${inputId}" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(placeholder)}" class="civitai-chip-editor-field">
        <button type="button" class="civitai-chip-editor-add" aria-label="${escapeHtml(addButtonLabel)}">+</button>
      </div>
    </div>
    <div class="civitai-chip-editor-chips" role="list" aria-live="polite"></div>
    <p class="civitai-chip-editor-helper">${escapeHtml(helperText)}</p>
  `;

  const state = {
    values: [],
    source: sourceValues,
  };

  const chipsContainer = root.querySelector(".civitai-chip-editor-chips");
  const inputEl = root.querySelector(".civitai-chip-editor-field");
  const addButton = root.querySelector(".civitai-chip-editor-add");
  const addAllButton = root.querySelector(".civitai-chip-editor-add-all");
  const helperEl = root.querySelector(".civitai-chip-editor-helper");
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};

  function containsValue(value) {
    const key = value.toLowerCase();
    return state.values.some((v) => v.toLowerCase() === key);
  }

  function renderChips() {
    chipsContainer.innerHTML = "";
    state.values.forEach((value, index) => {
      const chip = document.createElement("div");
      chip.className = "civitai-chip-editor-chip";
      chip.setAttribute("role", "listitem");
      const textSpan = document.createElement("span");
      textSpan.className = "civitai-chip-editor-chip-label";
      textSpan.textContent = value;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "civitai-chip-editor-chip-remove";
      removeBtn.setAttribute("aria-label", `Remove ${value}`);
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => {
        state.values.splice(index, 1);
        renderChips();
        updateAddAllState();
        onChange([...state.values]);
        inputEl.focus();
      });
      chip.appendChild(textSpan);
      chip.appendChild(removeBtn);
      chipsContainer.appendChild(chip);
    });
    updateAddAllState();
  }

  function addValue(raw) {
    if (!raw) return false;
    const text = String(raw).trim();
    if (!text) return false;
    if (containsValue(text)) return false;
    state.values.push(text);
    return true;
  }

  function addValues(values) {
    let added = false;
    values.forEach((value) => {
      if (addValue(value)) added = true;
    });
    if (added) {
      renderChips();
      onChange([...state.values]);
    }
    return added;
  }

  function commitInput() {
    const raw = inputEl.value;
    if (!raw) return false;
    const pieces = raw.split(/[\n,]/).map((part) => part.trim()).filter(Boolean);
    inputEl.value = "";
    const added = addValues(pieces);
    updateAddButtonState();
    return added;
  }

  function updateAddButtonState() {
    const text = inputEl.value.trim();
    addButton.disabled = !text || containsValue(text);
  }

  function updateAddAllState() {
    if (!addAllButton) return;
    if (!Array.isArray(state.source) || state.source.length === 0) {
      addAllButton.disabled = true;
      if (helperEl && !helperEl.dataset.baseMessage) {
        helperEl.dataset.baseMessage = helperEl.textContent || "";
      }
      return;
    }
    const missing = state.source.some((value) => !containsValue(value));
    addAllButton.disabled = !missing;
  }

  addButton.addEventListener("click", () => {
    commitInput();
    inputEl.focus();
  });

  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitInput();
    } else if (event.key === "Backspace" && !inputEl.value) {
      state.values.pop();
      renderChips();
      onChange([...state.values]);
      updateAddAllState();
    }
  });

  inputEl.addEventListener("input", updateAddButtonState);

  inputEl.addEventListener("paste", (event) => {
    try {
      const text = event.clipboardData?.getData("text") || "";
      if (text) {
        event.preventDefault();
        const pieces = text.split(/[\n,]/).map((part) => part.trim()).filter(Boolean);
        addValues(pieces);
        updateAddButtonState();
      }
    } catch (e) {
      console.warn("Chip editor paste failed", e);
    }
  });

  if (addAllButton) {
    addAllButton.addEventListener("click", () => {
      addValues(state.source);
      updateAddAllState();
      inputEl.focus();
    });
  }

  updateAddAllState();
  updateAddButtonState();

  return {
    getValues: () => [...state.values],
    setValues: (values, silent = false) => {
      const sanitized = sanitizeList(values, 256);
      state.values = sanitized;
      renderChips();
      if (!silent) onChange([...state.values]);
    },
    setSourceValues: (values) => {
      state.source = sanitizeList(values, 256);
      updateAddAllState();
    },
    focus: () => {
      inputEl.focus();
    },
    clearInput: () => {
      inputEl.value = "";
      updateAddButtonState();
    },
  };
}
