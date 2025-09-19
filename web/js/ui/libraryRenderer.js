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

    const trainedHtml = trainedWords
      .slice(0, 6)
      .map((word) => `<span class="civitai-library-pill" title="Copy trigger">${escapeHtml(word)}</span>`)
      .join("");

    const tagList = Array.isArray(item.tags)
      ? item.tags.map(t => typeof t === 'string' ? t : (t && typeof t.name === 'string' ? t.name : '')).filter(Boolean)
      : [];
    const tagsHtml = tagList
      .slice(0, 10)
      .map((tag) => `<span class="civitai-library-pill" title="Copy tag">${escapeHtml(tag)}</span>`)
      .join("");

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
        ${trainedHtml ? `<div class="civitai-library-tags" data-id="${escapeHtml(id)}">${trainedHtml}</div>` : ''}
        ${tagsHtml ? `<div class="civitai-library-tags" data-id="${escapeHtml(id)}">${tagsHtml}</div>` : ''}
      </div>
      <div class="civitai-library-actions">
        <button class="civitai-button small civitai-library-details" data-model-id="${escapeHtml(String(item.model_id || ''))}" data-version-id="${escapeHtml(String(item.version_id || ''))}" title="View details"><i class="fas fa-search-plus"></i></button>
        <button class="civitai-button small civitai-library-open" data-id="${escapeHtml(id)}" ${exists ? '' : 'disabled'} title="Open containing folder"><i class="fas fa-folder-open"></i></button>
        <button class="civitai-button small civitai-library-add" data-id="${escapeHtml(id)}" ${exists ? '' : 'disabled'} title="Add to ComfyUI"><i class="fas fa-plus-circle"></i></button>
        <button class="civitai-button small civitai-library-workflow" data-id="${escapeHtml(id)}" ${exists ? '' : 'disabled'} title="Workflow"><i class="fas fa-project-diagram"></i></button>
        <button class="civitai-button danger small civitai-library-delete" data-id="${escapeHtml(id)}" title="Remove from disk"><i class="fas fa-trash-alt"></i></button>
      </div>
    `;

    fragment.appendChild(container);
  });

  ui.libraryListContainer.innerHTML = "";
  ui.libraryListContainer.appendChild(fragment);
  ui.ensureFontAwesome();
}
