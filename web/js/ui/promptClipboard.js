import {
  CLIPBOARD_SEPARATOR_OPTIONS,
  DEFAULT_SEPARATOR,
  coerceSeparator,
  formatPromptItems,
  parsePromptText,
  reorderItems,
  sanitizePromptItems,
} from "../utils/promptClipboard.js";
import { copyTextToClipboard, readTextFromClipboard } from "../utils/clipboardAccess.js";

let clipboardInstance = 0;

export function createPromptClipboard(root, options = {}) {
  if (!root) throw new Error("Prompt clipboard root element is required");
  const instanceId = ++clipboardInstance;
  const listId = `civitai-prompt-clipboard-list-${instanceId}`;
  const separatorId = `civitai-prompt-clipboard-separator-${instanceId}`;
  const targetId = `civitai-prompt-clipboard-target-${instanceId}`;
  const titleId = `civitai-prompt-clipboard-title-${instanceId}`;

  const targetOptions = Array.isArray(options.targets) && options.targets.length
    ? options.targets
    : [
        { value: "triggers", label: "Custom triggers" },
        { value: "tags", label: "Custom tags" },
      ];

  root.classList.add("civitai-prompt-clipboard");
  root.innerHTML = `
    <div class="civitai-prompt-clipboard-header">
      <h4 id="${titleId}" class="civitai-prompt-clipboard-title">Clipboard</h4>
      <span class="civitai-prompt-clipboard-count" aria-live="polite">0 items</span>
    </div>
    <div class="civitai-prompt-clipboard-toolbar" role="group" aria-labelledby="${titleId}">
      <label class="civitai-prompt-clipboard-label" for="${separatorId}">
        Separator
      </label>
      <select id="${separatorId}" class="civitai-prompt-clipboard-select" aria-label="Clipboard separator"></select>
      <label class="civitai-prompt-clipboard-label" for="${targetId}">
        Apply to
      </label>
      <select id="${targetId}" class="civitai-prompt-clipboard-select" aria-label="Clipboard apply target"></select>
      <div class="civitai-prompt-clipboard-actions" role="group" aria-label="Clipboard actions">
        <button type="button" class="civitai-clipboard-copy">Copy</button>
        <button type="button" class="civitai-clipboard-paste">Paste</button>
        <button type="button" class="civitai-clipboard-clear">Clear</button>
        <button type="button" class="civitai-clipboard-apply primary">Apply</button>
      </div>
    </div>
    <ul id="${listId}" class="civitai-prompt-clipboard-list" role="list" aria-describedby="${titleId}"></ul>
    <div class="civitai-prompt-clipboard-footer">
      <button type="button" class="civitai-clipboard-add">Add item</button>
      <button type="button" class="civitai-clipboard-save">Save as prompt group</button>
    </div>
  `;

  const listEl = root.querySelector(`#${listId}`);
  const separatorSelect = root.querySelector(`#${separatorId}`);
  const targetSelect = root.querySelector(`#${targetId}`);
  const countEl = root.querySelector(".civitai-prompt-clipboard-count");
  const copyButton = root.querySelector(".civitai-clipboard-copy");
  const pasteButton = root.querySelector(".civitai-clipboard-paste");
  const clearButton = root.querySelector(".civitai-clipboard-clear");
  const applyButton = root.querySelector(".civitai-clipboard-apply");
  const addButton = root.querySelector(".civitai-clipboard-add");
  const saveButton = root.querySelector(".civitai-clipboard-save");

  const onItemsChange = typeof options.onItemsChange === "function" ? options.onItemsChange : () => {};
  const onApply = typeof options.onApply === "function" ? options.onApply : null;
  const onSaveGroup = typeof options.onSaveGroup === "function" ? options.onSaveGroup : null;
  const onToast = typeof options.onToast === "function" ? options.onToast : () => {};
  const onTargetChange = typeof options.onTargetChange === "function" ? options.onTargetChange : () => {};

  CLIPBOARD_SEPARATOR_OPTIONS.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    separatorSelect.appendChild(option);
  });
  separatorSelect.value = coerceSeparator(options.defaultSeparator);

  targetOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    targetSelect.appendChild(option);
  });
  targetSelect.value = targetOptions[0]?.value || "triggers";

  const state = {
    items: [],
    separator: separatorSelect.value || DEFAULT_SEPARATOR,
    target: targetSelect.value,
  };

  function updateCount() {
    const count = state.items.filter((item) => String(item || "").trim()).length;
    const label = count === 1 ? "1 item" : `${count} items`;
    if (countEl) countEl.textContent = label;
    const hasItems = count > 0;
    copyButton.disabled = !hasItems;
    clearButton.disabled = !hasItems;
    applyButton.disabled = !hasItems;
    saveButton.disabled = !hasItems;
  }

  function focusInput(index) {
    const targetItem = listEl?.querySelector(`li[data-index="${index}"] input`);
    if (targetItem) {
      targetItem.focus();
      targetItem.select();
    }
  }

  function removeIndex(index) {
    if (!Array.isArray(state.items)) return;
    if (index < 0 || index >= state.items.length) return;
    state.items.splice(index, 1);
    renderList();
    onItemsChange([...state.items]);
    updateCount();
  }

  function moveIndex(from, to) {
    const reordered = reorderItems(state.items, from, to);
    state.items = reordered;
    renderList();
    onItemsChange([...state.items]);
    updateCount();
    focusInput(Math.max(0, Math.min(to, state.items.length - 1)));
  }

  function handleInputChange(event) {
    const index = Number(event.currentTarget?.dataset?.index);
    if (!Number.isInteger(index)) return;
    const value = event.currentTarget.value;
    state.items[index] = value;
    onItemsChange([...state.items]);
    updateCount();
  }

  function handleInputBlur(event) {
    const index = Number(event.currentTarget?.dataset?.index);
    if (!Number.isInteger(index)) return;
    const value = String(event.currentTarget.value || "").trim();
    if (!value) {
      removeIndex(index);
    } else {
      state.items[index] = value;
      renderList();
      onItemsChange([...state.items]);
      updateCount();
    }
  }

  function addEmptyItem(focus = true) {
    state.items.push("");
    renderList();
    onItemsChange([...state.items]);
    updateCount();
    if (focus) {
      focusInput(state.items.length - 1);
    }
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    state.items.forEach((raw, index) => {
      const value = String(raw ?? "");
      const item = document.createElement("li");
      item.className = "civitai-prompt-clipboard-item";
      item.setAttribute("role", "listitem");
      item.dataset.index = String(index);
      item.draggable = true;

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "civitai-prompt-clipboard-handle";
      handle.setAttribute("aria-label", `Reorder item ${index + 1}`);
      handle.innerHTML = "&#x2630;";
      handle.addEventListener("click", () => {
        focusInput(index);
      });

      const input = document.createElement("input");
      input.type = "text";
      input.value = value;
      input.dataset.index = String(index);
      input.className = "civitai-prompt-clipboard-input";
      input.setAttribute("aria-label", `Clipboard item ${index + 1}`);
      input.addEventListener("input", handleInputChange);
      input.addEventListener("blur", handleInputBlur);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey) {
          event.preventDefault();
          addEmptyItem(true);
        } else if ((event.altKey || event.ctrlKey) && event.key === "ArrowUp") {
          event.preventDefault();
          moveIndex(index, index - 1);
        } else if ((event.altKey || event.ctrlKey) && event.key === "ArrowDown") {
          event.preventDefault();
          moveIndex(index, index + 1);
        } else if (event.ctrlKey && event.key === "Enter") {
          event.preventDefault();
          applyCurrent();
        }
      });

      const actions = document.createElement("div");
      actions.className = "civitai-prompt-clipboard-item-actions";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "civitai-prompt-clipboard-move";
      upBtn.setAttribute("aria-label", `Move item ${index + 1} up`);
      upBtn.textContent = "↑";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => moveIndex(index, index - 1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "civitai-prompt-clipboard-move";
      downBtn.setAttribute("aria-label", `Move item ${index + 1} down`);
      downBtn.textContent = "↓";
      downBtn.disabled = index === state.items.length - 1;
      downBtn.addEventListener("click", () => moveIndex(index, index + 1));

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "civitai-prompt-clipboard-remove";
      removeBtn.setAttribute("aria-label", `Remove item ${index + 1}`);
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => {
        removeIndex(index);
      });

      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(removeBtn);

      item.appendChild(handle);
      item.appendChild(input);
      item.appendChild(actions);

      item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", String(index));
        event.dataTransfer?.setDragImage?.(item, 10, 10);
        item.classList.add("dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        item.classList.add("dragover");
      });
      item.addEventListener("dragleave", () => item.classList.remove("dragover"));
      item.addEventListener("drop", (event) => {
        event.preventDefault();
        item.classList.remove("dragover");
        const fromIndex = Number(event.dataTransfer?.getData("text/plain"));
        const toIndex = index;
        if (Number.isInteger(fromIndex) && fromIndex !== toIndex) {
          moveIndex(fromIndex, toIndex);
        }
      });

      listEl.appendChild(item);
    });
    if (state.items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "civitai-prompt-clipboard-empty";
      empty.textContent = "Clipboard is empty";
      empty.setAttribute("aria-live", "polite");
      listEl.appendChild(empty);
    }
  }

  async function copyCurrent() {
    const formatted = formatPromptItems(state.items, state.separator);
    if (!formatted) {
      onToast("Nothing to copy", "info");
      return;
    }
    const success = await copyTextToClipboard(formatted);
    onToast(success ? "Copied to clipboard" : "Failed to copy", success ? "success" : "error");
  }

  async function pasteIntoClipboard() {
    const text = await readTextFromClipboard();
    if (!text) {
      onToast("Clipboard was empty", "info");
      return;
    }
    const parsed = parsePromptText(text, state.separator);
    if (parsed.length === 0) {
      onToast("No prompts found in clipboard", "info");
      return;
    }
    state.items = sanitizePromptItems([...state.items, ...parsed], 256);
    renderList();
    onItemsChange([...state.items]);
    updateCount();
    onToast(`Added ${parsed.length} item${parsed.length === 1 ? "" : "s"} from clipboard`, "success");
  }

  function clearClipboard() {
    if (!state.items.length) return;
    state.items = [];
    renderList();
    onItemsChange([]);
    updateCount();
  }

  async function applyCurrent(customItems = null) {
    if (!onApply) return;
    const sanitized = sanitizePromptItems(
      customItems === null ? state.items : customItems,
      256,
    );
    if (!sanitized.length) {
      onToast("Clipboard is empty", "info");
      return;
    }
    try {
      await onApply(sanitized, { target: state.target, separator: state.separator });
      onToast(`Applied ${sanitized.length} item${sanitized.length === 1 ? "" : "s"}`, "success");
    } catch (error) {
      console.warn("Clipboard apply failed", error);
      onToast(error?.message || "Failed to apply clipboard", "error");
    }
  }

  async function saveCurrent() {
    if (!onSaveGroup) return;
    const sanitized = sanitizePromptItems(state.items, 256);
    if (!sanitized.length) {
      onToast("Clipboard is empty", "info");
      return;
    }
    try {
      await onSaveGroup(sanitized, { target: state.target, separator: state.separator });
    } catch (error) {
      console.warn("Save prompt group failed", error);
      onToast(error?.message || "Failed to save prompt group", "error");
    }
  }

  separatorSelect.addEventListener("change", (event) => {
    state.separator = coerceSeparator(event.target.value);
  });

  targetSelect.addEventListener("change", (event) => {
    state.target = event.target.value;
    onTargetChange(state.target);
  });

  copyButton.addEventListener("click", () => copyCurrent());
  pasteButton.addEventListener("click", () => pasteIntoClipboard());
  clearButton.addEventListener("click", () => clearClipboard());
  applyButton.addEventListener("click", () => applyCurrent());
  addButton.addEventListener("click", () => addEmptyItem(true));
  saveButton.addEventListener("click", () => saveCurrent());

  root.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.shiftKey && event.code === "KeyC") {
      event.preventDefault();
      copyCurrent();
    } else if (event.shiftKey && event.code === "KeyV") {
      event.preventDefault();
      pasteIntoClipboard();
    } else if (event.key === "Enter") {
      event.preventDefault();
      applyCurrent();
    }
  });

  renderList();
  updateCount();

  return {
    getItems: ({ sanitized = false } = {}) =>
      sanitized ? sanitizePromptItems(state.items, 256) : [...state.items],
    setItems: (items, { append = false } = {}) => {
      const sanitized = sanitizePromptItems(items, 256);
      state.items = append
        ? sanitizePromptItems([...state.items, ...sanitized], 256)
        : sanitized;
      renderList();
      updateCount();
      onItemsChange([...state.items]);
    },
    appendItems: (items) => {
      const sanitized = sanitizePromptItems(items, 256);
      if (!sanitized.length) return;
      state.items = sanitizePromptItems([...state.items, ...sanitized], 256);
      renderList();
      updateCount();
      onItemsChange([...state.items]);
    },
    clear: () => {
      clearClipboard();
    },
    focus: () => {
      focusInput(0);
    },
    isEmpty: () => state.items.length === 0,
    getSeparator: () => state.separator,
    setSeparator: (value) => {
      const next = coerceSeparator(value);
      state.separator = next;
      separatorSelect.value = next;
    },
    getTarget: () => state.target,
    setTarget: (value) => {
      if (targetOptions.some((opt) => opt.value === value)) {
        state.target = value;
        targetSelect.value = value;
      }
    },
    apply: (items) => applyCurrent(items ?? state.items),
  };
}
