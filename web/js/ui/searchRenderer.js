// web/js/ui/searchRenderer.js
// Rendering helpers for search result cards and inline download drawer.
const PLACEHOLDER_IMAGE_URL = `/extensions/Civicomfy/images/placeholder.jpeg`;

function isVideoUrl(url = '') {
  try {
    return /\.(mp4|webm|mov)(?:\?|$)/i.test(String(url));
  } catch (_) {
    return false;
  }
}

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
  card.dataset.provider = (model.provider || 'civitai').toLowerCase();
  if (model.thumbUrl) card.dataset.thumbnail = model.thumbUrl;
  card.__civitaiVersions = Array.isArray(model.versions) ? model.versions : [];
  if (model.raw) card.__civitaiRaw = model.raw;

  const statsText = buildStatsText(model);

  const thumbSrc = String(model.thumbUrl || '').trim();
  const onError = `this.onerror=null; this.src='${PLACEHOLDER_IMAGE_URL}';`;
  const thumbHtml = isVideoUrl(thumbSrc)
    ? `<img src="${PLACEHOLDER_IMAGE_URL}" alt="${escapeHtml(model.title || '')}" loading="lazy">`
    : `<img src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(model.title || '')}" loading="lazy" onerror="${onError}">`;

  card.innerHTML = `
    <div class="civi-card-top">
      <div class="civi-thumb">${thumbHtml}</div>
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
      <button class="civi-btn civi-btn-details" title="View details" aria-label="View details"><i class="fas fa-search-plus"></i></button>
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
          <label>Model type:
            <select class="civi-target-root"></select>
          </label>
          <div class="civi-folder-fields">
            <label>Base model folder:
              <input class="civi-base-folder-input" placeholder="e.g. Illustrious">
            </label>
            <label>Model name folder:
              <input class="civi-model-folder-input" placeholder="e.g. catslora">
            </label>
            <label>Version folder:
              <input class="civi-version-folder-input" placeholder="e.g. catsv1">
            </label>
          </div>
          <div class="civi-path-preview" aria-live="polite"></div>
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
    <div class="civi-status-footer hidden" aria-hidden="true">
      <div class="civi-status-line">
        <div class="civi-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">0%</div>
        <div class="civi-status-text"></div>
      </div>
      <div class="civi-status-error" hidden></div>
      <div class="civi-status-actions"></div>
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
  const provider = (cardEl.dataset.provider || 'civitai').toLowerCase();
  const isHuggingFace = provider === 'huggingface';
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
      const fileId = file.id ?? file.file_id ?? file.path ?? file.name;
      if (fileId === undefined || fileId === null) return;
      const value = String(fileId);
      const disabled = file.downloadable === false;
      const filePath = (file.metadata && file.metadata.path) || file.huggingface?.path || file.file_path || file.path || file.name || value;
      let sizeBytes = file.size_bytes ?? file.sizeBytes;
      if (!Number.isFinite(sizeBytes)) {
        const sizeKb = Number(file.size_kb ?? file.sizeKB);
        if (Number.isFinite(sizeKb)) {
          sizeBytes = sizeKb * 1024;
        } else {
          sizeBytes = undefined;
        }
      }
      const displaySize = Number.isFinite(sizeBytes) ? formatBytes(sizeBytes) : 'Unknown size';

      const row = document.createElement('div');
      row.className = 'civi-file-row';
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = isHuggingFace ? 'checkbox' : 'radio';
      if (!isHuggingFace) {
        input.name = `file-${cardEl.dataset.modelId}-${cardEl.dataset.versionId || ''}`;
      }
      input.className = isHuggingFace ? 'civi-file-checkbox' : 'civi-file-radio';
      input.value = value;
      if (file.primary || file.isPrimary) input.checked = true;
      if (disabled) input.disabled = true;
      if (filePath) input.dataset.filePath = filePath;
      if (file.downloadUrl) input.dataset.downloadUrl = file.downloadUrl;
      if (Number.isFinite(sizeBytes)) input.dataset.sizeBytes = String(sizeBytes);
      if (isHuggingFace && (file.primary || file.isPrimary)) {
        input.dataset.primary = 'true';
      }
      if (isHuggingFace && file.name) {
        input.dataset.filename = file.name;
      }
      label.appendChild(input);
      label.appendChild(document.createTextNode(' '));

      const textSpan = document.createElement('span');
      textSpan.textContent = `${file.name || `File ${value}`} (${displaySize})`;
      label.appendChild(textSpan);

      if (disabled) {
        const unavailable = document.createElement('span');
        unavailable.className = 'civi-file-unavailable';
        unavailable.textContent = ' (unavailable)';
        label.appendChild(unavailable);
      }

      row.appendChild(label);
      filesList.appendChild(row);
    });
    if (isHuggingFace) {
      ensureHuggingFaceDefaultSelection(filesList);
      setupHuggingFaceFileSelection(filesList);
    } else {
      const firstAvailable = filesList.querySelector('.civi-file-radio:not([disabled])');
      if (firstAvailable && !filesList.querySelector('.civi-file-radio:checked')) {
        firstAvailable.checked = true;
      }
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

  const baseInput = cardEl.querySelector('.civi-base-folder-input');
  if (baseInput && defaults?.baseFolder !== undefined) {
    baseInput.value = defaults.baseFolder || '';
    if (cardEl.dataset) {
      cardEl.dataset.autoBaseFolder = defaults.baseFolder || '';
      cardEl.dataset.userBaseFolderDirty = 'false';
    }
  }

  const modelInput = cardEl.querySelector('.civi-model-folder-input');
  if (modelInput && defaults?.modelFolder !== undefined) {
    modelInput.value = defaults.modelFolder || '';
    if (cardEl.dataset) {
      cardEl.dataset.autoModelFolder = defaults.modelFolder || '';
      cardEl.dataset.userModelFolderDirty = 'false';
    }
  }

  const versionInput = cardEl.querySelector('.civi-version-folder-input');
  if (versionInput && defaults?.versionFolder !== undefined) {
    versionInput.value = defaults.versionFolder || '';
    if (cardEl.dataset) {
      cardEl.dataset.autoVersionFolder = defaults.versionFolder || '';
      cardEl.dataset.userVersionFolderDirty = 'false';
    }
  }

  const filenameInput = cardEl.querySelector('.civi-filename-input');
  if (filenameInput && defaults?.filename !== undefined) {
    filenameInput.value = defaults.filename;
  }
}

function ensureHuggingFaceDefaultSelection(filesList) {
  if (!filesList) return;
  const checkboxes = Array.from(filesList.querySelectorAll('.civi-file-checkbox:not([disabled])'));
  if (checkboxes.length === 0) return;
  if (checkboxes.some(cb => cb.checked)) return;
  const primary = checkboxes.find(cb => cb.dataset.primary === 'true');
  const fallback = checkboxes[0];
  const toSelect = primary || fallback;
  if (toSelect) {
    toSelect.checked = true;
  }
}

function setupHuggingFaceFileSelection(filesList) {
  if (!filesList) return;
  const checkboxes = Array.from(filesList.querySelectorAll('.civi-file-checkbox'));
  if (checkboxes.length <= 1) return;

  const existing = filesList.querySelector('.civi-select-all-row');
  if (existing) existing.remove();

  const selectAllRow = document.createElement('div');
  selectAllRow.className = 'civi-file-row civi-select-all-row';
  const label = document.createElement('label');
  label.className = 'civi-select-all-label';
  const selectAllInput = document.createElement('input');
  selectAllInput.type = 'checkbox';
  selectAllInput.className = 'civi-select-all-checkbox';
  label.appendChild(selectAllInput);
  label.appendChild(document.createTextNode(' Select All'));
  const countSpan = document.createElement('span');
  countSpan.className = 'civi-select-count';
  label.appendChild(countSpan);
  selectAllRow.appendChild(label);
  filesList.insertBefore(selectAllRow, filesList.firstChild);

  const getCheckboxes = () => Array.from(filesList.querySelectorAll('.civi-file-checkbox'));
  const getEnabledCheckboxes = () => getCheckboxes().filter(cb => !cb.disabled);

  const updateSelectAllState = () => {
    const enabled = getEnabledCheckboxes();
    const total = enabled.length;
    const selected = enabled.filter(cb => cb.checked).length;

    if (total === 0) {
      selectAllInput.checked = false;
      selectAllInput.indeterminate = false;
      countSpan.textContent = '';
      return;
    }

    if (selected === 0) {
      selectAllInput.checked = false;
      selectAllInput.indeterminate = false;
    } else if (selected === total) {
      selectAllInput.checked = true;
      selectAllInput.indeterminate = false;
    } else {
      selectAllInput.checked = false;
      selectAllInput.indeterminate = true;
    }

    countSpan.textContent = ` (${selected}/${total})`;
  };

  selectAllInput.addEventListener('change', () => {
    const enabled = getEnabledCheckboxes();
    enabled.forEach(cb => {
      cb.checked = selectAllInput.checked;
    });
    updateSelectAllState();
  });

  getCheckboxes().forEach(cb => {
    cb.addEventListener('change', updateSelectAllState);
  });

  updateSelectAllState();
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
