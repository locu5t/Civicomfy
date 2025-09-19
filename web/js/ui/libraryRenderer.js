const PLACEHOLDER_IMAGE_URL = `/extensions/Civicomfy/images/placeholder.jpeg`;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (match) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[match]);
}

function sanitizeList(values = []) {
  if (!Array.isArray(values)) return [];
  const cleaned = [];
  const seen = new Set();
  values.forEach((value) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push(text);
  });
  return cleaned;
}

function buildChipEntries(primary = [], custom = [], limit = Infinity) {
  const entries = [];
  const seen = new Set();
  const pushList = (list, isCustom) => {
    sanitizeList(list).forEach((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ value, isCustom });
    });
  };
  pushList(custom, true);
  pushList(primary, false);
  return Number.isFinite(limit) ? entries.slice(0, limit) : entries;
}

function chipsToHtml(entries = [], title = "Copy value") {
  return entries
    .map(({ value, isCustom }) => `<span class="civitai-library-pill${isCustom ? ' civitai-library-pill-custom' : ''}" title="${escapeHtml(title)}">${escapeHtml(value)}</span>`)
    .join("");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function renderLibraryList(ui, items = []) {
  if (!ui.libraryListContainer) return;

  if (!Array.isArray(items) || items.length === 0) {
    ui.libraryListContainer.innerHTML = '<p class="civitai-library-empty">No downloaded models yet. Queue downloads from the Search tab.</p>';
    ui.ensureFontAwesome();
    return;
  }

  const fragment = document.createDocumentFragment();
  const blurEnabled = ui.settings?.hideMatureInSearch === true;
  const blurThreshold = Number(ui.settings?.nsfwBlurMinLevel ?? 4);

  items.forEach((item) => {
    const id = item.id || "";
    const modelName = item.model_name || "Unknown Model";
    const versionName = item.version_name || "Unknown Version";
    const typeName = item.model_type || "";
    const resolvedType = typeName && ui.modelTypes ? ui.modelTypes[typeName] || typeName : typeName;
    const sizeText = item.size_bytes ? ui.formatBytes(item.size_bytes) : "";
    const downloadedAt = formatDate(item.downloaded_at);
    const publishedAt = formatDate(item.published_at);
    const exists = item.exists !== false;
    const path = item.path || "Not available";
    const nsfwLevel = Number(item.thumbnail_nsfw_level ?? 0);
    const shouldBlur = blurEnabled && Number.isFinite(nsfwLevel) && nsfwLevel >= blurThreshold;
    const onDiskText = exists ? "On disk" : (item.deleted ? "Deleted" : "Missing");
    const trainedWords = Array.isArray(item.trained_words) ? item.trained_words : [];

    const container = document.createElement("div");
    container.className = `civitai-library-item${exists ? "" : " missing"}`;
    container.dataset.id = id;

    const thumbContainerClass = `civitai-thumbnail-container${shouldBlur ? " blurred" : ""}`;
    const overlayHtml = shouldBlur ? '<div class="civitai-nsfw-overlay" title="R-rated: click to reveal">R</div>' : '';
    const onError = `this.onerror=null; this.src='${PLACEHOLDER_IMAGE_URL}';`;
    // Prefer local preview if available to ensure image-type thumbnail
    const localPreview = item.preview_path ? `/civitai/local_media?path=${encodeURIComponent(item.preview_path)}` : '';
    const remoteThumb = item.thumbnail || '';
    const useSrc = localPreview || remoteThumb || PLACEHOLDER_IMAGE_URL;

    const tagList = Array.isArray(item.tags)
      ? item.tags.map(t => typeof t === 'string' ? t : (t && typeof t.name === 'string' ? t.name : '')).filter(Boolean)
      : [];
    const customTriggers = Array.isArray(item.custom_triggers) ? item.custom_triggers : [];
    const customTags = Array.isArray(item.custom_tags) ? item.custom_tags : [];

    const triggerEntries = buildChipEntries(trainedWords, customTriggers, 6);
    const tagsEntries = buildChipEntries(tagList, customTags, 10);
    const triggersHtml = triggerEntries.length
      ? `<div class="civitai-library-tags" data-id="${escapeHtml(id)}">${chipsToHtml(triggerEntries, 'Copy trigger')}</div>`
      : '';
    const tagsHtml = tagsEntries.length
      ? `<div class="civitai-library-tags" data-id="${escapeHtml(id)}">${chipsToHtml(tagsEntries, 'Copy tag')}</div>`
      : '';
    const hasCustomMeta = sanitizeList(customTriggers).length > 0 || sanitizeList(customTags).length > 0;

    container.innerHTML = `
      <div class="${thumbContainerClass}" data-nsfw-level="${Number.isFinite(nsfwLevel) ? nsfwLevel : ''}">
        <img src="${escapeHtml(useSrc)}" alt="${escapeHtml(modelName)}" class="civitai-download-thumbnail" loading="lazy" onerror="${onError}">
        ${overlayHtml}
      </div>
      <div class="civitai-library-details">
        <div class="civitai-library-title">${escapeHtml(modelName)}</div>
        <div class="civitai-library-meta">
          <span title="Version">Ver: ${escapeHtml(versionName)}</span>
          ${resolvedType ? `<span title="Model type">${escapeHtml(resolvedType)}</span>` : ''}
          ${sizeText ? `<span title="File size">${escapeHtml(sizeText)}</span>` : ''}
          <span class="civitai-library-status ${exists ? 'status-ok' : 'status-missing'}">${escapeHtml(onDiskText)}</span>
        </div>
        <div class="civitai-library-path" title="${escapeHtml(path)}">${escapeHtml(path)}</div>
        ${publishedAt ? `<div class="civitai-library-date">Published: ${escapeHtml(publishedAt)}</div>` : ''}
        ${downloadedAt ? `<div class="civitai-library-date">Downloaded: ${escapeHtml(downloadedAt)}</div>` : ''}
        ${triggersHtml}
        ${tagsHtml}
      </div>
      <div class="civitai-library-actions">
        <button class="civitai-button small civitai-library-details" data-model-id="${escapeHtml(String(item.model_id || ''))}" data-version-id="${escapeHtml(String(item.version_id || ''))}" title="View details"><i class="fas fa-search-plus"></i></button>
        <button class="civitai-button small civitai-library-open" data-id="${escapeHtml(id)}" ${exists ? '' : 'disabled'} title="Open containing folder"><i class="fas fa-folder-open"></i></button>
        <button class="civitai-button small civitai-library-add" data-id="${escapeHtml(id)}" ${exists ? '' : 'disabled'} title="Add to ComfyUI"><i class="fas fa-plus-circle"></i></button>
        <button class="civitai-button small civitai-library-workflow" data-id="${escapeHtml(id)}" ${exists ? '' : 'disabled'} title="Workflow"><i class="fas fa-project-diagram"></i></button>
        <button class="civitai-button small civitai-library-edit-meta${hasCustomMeta ? ' has-custom' : ''}" data-id="${escapeHtml(id)}" title="Edit tags &amp; triggers" aria-label="Edit tags &amp; triggers"><i class="icon-tag" aria-hidden="true"></i></button>
        <button class="civitai-button danger small civitai-library-delete" data-id="${escapeHtml(id)}" title="Remove from disk"><i class="fas fa-trash-alt"></i></button>
      </div>
    `;

    fragment.appendChild(container);
  });

  ui.libraryListContainer.innerHTML = "";
  ui.libraryListContainer.appendChild(fragment);
  ui.ensureFontAwesome();
}
