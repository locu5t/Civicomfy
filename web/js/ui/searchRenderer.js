// web/js/ui/searchRenderer.js
// Rendering helpers for search result cards and inline download drawer.

export function renderSearchResults(containerEl, results = []) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  if (!Array.isArray(results) || results.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No results yet. Try adjusting your filters.';
    containerEl.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  results.forEach(result => {
    const card = createCardElement(result);
    if (card) frag.appendChild(card);
  });
  containerEl.appendChild(frag);
}

export function createCardElement(model) {
  if (!model || !model.modelId) return null;
  const card = document.createElement('div');
  card.className = 'civi-card';
  card.dataset.modelId = model.modelId;
  card.dataset.modelType = model.modelType || '';
  card.dataset.baseModel = model.baseModel || '';
  card.dataset.modelName = model.title || '';
  card.dataset.versionId = model.versionId || '';
  card.dataset.versionName = model.versionName || '';
  card.__civitaiVersions = Array.isArray(model.versions) ? model.versions : [];
  if (model.raw) card.__civitaiRaw = model.raw;

  const statsText = buildStatsText(model);

  card.innerHTML = `
    <div class="civi-card-top">
      <div class="civi-thumb"><img src="${escapeHtml(model.thumbUrl || '')}" alt="${escapeHtml(model.title || '')}" loading="lazy"></div>
      <div class="civi-meta">
        <h4 class="civi-title">${escapeHtml(model.title || 'Untitled')}</h4>
        <div class="civi-author">by ${escapeHtml(model.author || 'Unknown')}</div>
        <div class="civi-stats">${statsText}</div>
      </div>
    </div>

    <div class="civi-actions">
      <select class="civi-version-select" aria-label="Select version"></select>
      <button class="civi-btn civi-btn-quick-download" title="Quick download" aria-label="Quick download">Download</button>
      <label class="civi-checkbox"><input type="checkbox" class="civi-card-select" /> Select</label>
      <button class="civi-btn civi-btn-details" title="Full details" aria-label="Full details">Details</button>
    </div>

    <div class="civi-local-meta">
      <div class="civi-local-path">Not downloaded</div>
      <div class="civi-triggers"></div>
    </div>

    <div class="civi-download-drawer hidden" aria-hidden="true">
      <div class="civi-drawer-inner">
        <div class="civi-drawer-preview"></div>

        <div class="civi-drawer-files">
          <div class="civi-files-heading">Files</div>
          <div class="civi-files-list"></div>
        </div>

        <div class="civi-drawer-targets">
          <label>Target location:
            <select class="civi-target-root"></select>
          </label>
          <label>Subfolder:
            <input class="civi-subdir-input" placeholder="optional subfolder">
          </label>
          <label>Filename override:
            <input class="civi-filename-input" placeholder="optional filename.safetensors">
          </label>
        </div>

        <div class="civi-drawer-options">
          <label><input type="checkbox" class="civi-force-checkbox"> Force redownload</label>
          <label><input type="checkbox" class="civi-preview-checkbox" checked> Generate preview</label>
        </div>

        <div class="civi-drawer-actions">
          <button class="civi-btn civi-btn-queue">Queue download</button>
          <button class="civi-btn civi-btn-close">Close</button>
        </div>
      </div>
    </div>
  `;

  const versionSelect = card.querySelector('.civi-version-select');
  populateVersionSelect(versionSelect, card.__civitaiVersions, model.versionId);

  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', model.title || 'Model card');

  return card;
}

function populateVersionSelect(selectEl, versions = [], selectedId) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const cleaned = Array.isArray(versions) ? versions.filter(v => v && (v.id || v.versionId)) : [];
  if (cleaned.length === 0) {
    const opt = document.createElement('option');
    opt.value = selectedId || '';
    opt.textContent = 'Default';
    selectEl.appendChild(opt);
    return;
  }
  cleaned.forEach(version => {
    const value = version.id || version.versionId;
    if (!value) return;
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = version.name || `Version ${value}`;
    if (String(value) === String(selectedId)) opt.selected = true;
    selectEl.appendChild(opt);
  });
  if (selectedId && !Array.from(selectEl.options).some(o => String(o.value) === String(selectedId))) {
    selectEl.value = String(cleaned[0].id || cleaned[0].versionId || '');
  }
}

export function toggleDrawer(cardEl, show = true) {
  if (!cardEl) return;
  const drawer = cardEl.querySelector('.civi-download-drawer');
  if (!drawer) return;
  if (show) {
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');
    cardEl.classList.add('drawer-open');
  } else {
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
    cardEl.classList.remove('drawer-open');
  }
}

export function populateDrawerWithDetails(cardEl, details, modelTypeOptions = [], defaults = {}) {
  if (!cardEl || !details) return;
  const previewEl = cardEl.querySelector('.civi-drawer-preview');
  if (previewEl) {
    const modelTitle = details.model_name || details.name || '';
    const versionName = details.version_name || details.versionName || '';
    const desc = stripHtml(details.description_html || details.description || '');
    const versionDesc = stripHtml(details.version_description_html || details.version_description || '');
    previewEl.innerHTML = `
      <div class="civi-preview-title">${escapeHtml(modelTitle)}</div>
      <div class="civi-preview-meta">Version: ${escapeHtml(versionName)}</div>
      <div class="civi-preview-desc">${escapeHtml((desc || '').slice(0, 400))}${desc && desc.length > 400 ? '…' : ''}</div>
      <div class="civi-preview-desc subtle">${escapeHtml((versionDesc || '').slice(0, 200))}${versionDesc && versionDesc.length > 200 ? '…' : ''}</div>
    `;
  }

  const filesList = cardEl.querySelector('.civi-files-list');
  if (filesList) {
    filesList.innerHTML = '';
    const files = Array.isArray(details.files) ? details.files : [];
    if (files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'civi-file-row';
      empty.textContent = 'No downloadable files exposed.';
      filesList.appendChild(empty);
    }
    files.forEach(file => {
      const fileId = file.id ?? file.file_id;
      if (!fileId && fileId !== 0) return;
      const sizeKb = Number(file.size_kb ?? file.sizeKB ?? 0);
      const disabled = file.downloadable === false;
      const radio = document.createElement('div');
      radio.className = 'civi-file-row';
      radio.innerHTML = `
        <label>
          <input type="radio" name="file-${cardEl.dataset.modelId}-${cardEl.dataset.versionId || ''}" class="civi-file-radio" value="${fileId}" ${file.primary || file.isPrimary ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          ${escapeHtml(file.name || `File ${fileId}`)} (${formatBytes(sizeKb * 1024)}) ${disabled ? '<span class="civi-file-unavailable">(unavailable)</span>' : ''}
        </label>
      `;
      filesList.appendChild(radio);
    });
    if (!filesList.querySelector('.civi-file-radio:checked')) {
      const firstRadio = filesList.querySelector('.civi-file-radio');
      if (firstRadio && !firstRadio.disabled) firstRadio.checked = true;
    }
  }

  const rootSelect = cardEl.querySelector('.civi-target-root');
  if (rootSelect) {
    rootSelect.innerHTML = '';
    const options = Array.isArray(modelTypeOptions) ? modelTypeOptions : [];
    options.forEach(opt => {
      if (!opt) return;
      const option = document.createElement('option');
      option.value = opt.value ?? opt.id ?? '';
      option.textContent = opt.label ?? opt.name ?? opt.displayName ?? option.value;
      rootSelect.appendChild(option);
    });
    if (defaults?.modelType && Array.from(rootSelect.options).some(o => o.value === defaults.modelType)) {
      rootSelect.value = defaults.modelType;
    } else if (rootSelect.options.length > 0 && !rootSelect.value) {
      rootSelect.selectedIndex = 0;
    }
  }

  const subdirInput = cardEl.querySelector('.civi-subdir-input');
  if (subdirInput && defaults?.subdir !== undefined) {
    subdirInput.value = defaults.subdir;
  }

  const filenameInput = cardEl.querySelector('.civi-filename-input');
  if (filenameInput && defaults?.filename !== undefined) {
    filenameInput.value = defaults.filename;
  }
}

export function renderLocalInfo(cardEl, localInfo) {
  if (!cardEl) return;
  const pathEl = cardEl.querySelector('.civi-local-path');
  const triggersEl = cardEl.querySelector('.civi-triggers');
  if (pathEl) {
    if (!localInfo || !Array.isArray(localInfo.local_paths) || localInfo.local_paths.length === 0) {
      pathEl.textContent = 'Not downloaded';
      pathEl.classList.remove('civi-clickable-path');
      pathEl.removeAttribute('title');
    } else {
      pathEl.textContent = localInfo.local_paths[0];
      pathEl.classList.add('civi-clickable-path');
      pathEl.title = 'Open containing folder';
    }
  }
  if (triggersEl) {
    triggersEl.innerHTML = '';
    const triggers = Array.isArray(localInfo?.triggers) ? localInfo.triggers : [];
    triggers.forEach(trigger => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'civi-trigger-pill';
      pill.textContent = trigger;
      pill.title = 'Click to copy trigger';
      triggersEl.appendChild(pill);
    });
  }
}

function buildStatsText(model) {
  const parts = [];
  if (model.downloads !== undefined && model.downloads !== null) {
    parts.push(`${formatNumber(model.downloads)} downloads`);
  }
  if (model.likes !== undefined && model.likes !== null) {
    parts.push(`${formatNumber(model.likes)} likes`);
  }
  if (model.baseModel) {
    parts.push(`Base: ${model.baseModel}`);
  }
  return escapeHtml(parts.join(' • '));
}

function stripHtml(html = '') {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function formatBytes(bytes) {
  if (!bytes || !Number.isFinite(bytes)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${Math.round(value * 10) / 10} ${units[unitIndex]}`;
}

function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString();
}
