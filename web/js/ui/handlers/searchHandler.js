import { toggleDrawer, populateDrawerWithDetails, renderLocalInfo } from '../searchRenderer.js';
import { CivitaiDownloaderAPI } from '../../api/civitai.js';

const POLL_INTERVAL = 3000;

export async function handleSearchSubmit(ui) {
  ui.searchSubmitButton.disabled = true;
  ui.searchSubmitButton.textContent = 'Searching...';
  ui.searchResultsContainer.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Searching...</p>';
  ui.searchPaginationContainer.innerHTML = '';
  ui.ensureFontAwesome();

  const params = {
    query: ui.searchQueryInput.value.trim(),
    model_types: ui.searchTypeSelect.value === 'any' ? [] : [ui.searchTypeSelect.value],
    base_models: ui.searchBaseModelSelect.value === 'any' ? [] : [ui.searchBaseModelSelect.value],
    sort: ui.searchSortSelect.value,
    limit: ui.searchPagination.limit,
    page: ui.searchPagination.currentPage,
    api_key: ui.settings.apiKey,
  };

  try {
    const response = await CivitaiDownloaderAPI.searchModels(params);
    if (!response || !response.metadata || !Array.isArray(response.items)) {
      console.error('Invalid search response structure:', response);
      throw new Error('Received invalid data from search API.');
    }

    ui.renderSearchResults(response.items);
    ui.renderSearchPagination(response.metadata);
  } catch (error) {
    const message = `Search failed: ${error.details || error.message || 'Unknown error'}`;
    console.error('Search Submit Error:', error);
    ui.searchResultsContainer.innerHTML = `<p style="color: var(--error-text, #ff6b6b);">${message}</p>`;
    ui.showToast(message, 'error');
  } finally {
    ui.searchSubmitButton.disabled = false;
    ui.searchSubmitButton.textContent = 'Search';
  }
}

export function initSearchHandlers(containerEl, options = {}) {
  if (!containerEl || containerEl.__civiHandlersAttached) return;
  containerEl.__civiHandlersAttached = true;

  const api = options.api || CivitaiDownloaderAPI;
  const toast = options.toast || ((msg, type) => {
    if (type === 'error') console.error(msg);
    else console.log(msg);
  });
  const getSettings = options.getSettings || (() => options.settings || {});
  const getModelTypeOptions = options.getModelTypeOptions || (() => []);
  const inferModelType = options.inferModelType || (() => null);

  containerEl.addEventListener('click', async (event) => {
    const card = event.target.closest('.civi-card');
    if (!card) return;

    if (event.target.closest('.civi-btn-quick-download')) {
      event.preventDefault();
      await handleQuickDownload(card, { api, toast, getSettings, getModelTypeOptions, inferModelType, options });
      return;
    }

    if (event.target.closest('.civi-btn-details')) {
      event.preventDefault();
      await handleDetails(card, { api, toast, getSettings, options });
      return;
    }

    if (event.target.closest('.civi-btn-close')) {
      event.preventDefault();
      toggleDrawer(card, false);
      return;
    }

    if (event.target.closest('.civi-trigger-pill')) {
      const text = event.target.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        toast(`${text} copied`, 'success');
      } catch (err) {
        toast('Failed to copy trigger', 'error');
      }
      return;
    }

    if (event.target.closest('.civi-local-path')) {
      event.preventDefault();
      const path = event.target.textContent;
      if (!path || path === 'Not downloaded') return;
      if (typeof options.onOpenLocalPath === 'function') {
        options.onOpenLocalPath(path, card);
      } else {
        toast('Open path not supported in this build', 'info');
      }
      return;
    }
  });

  containerEl.addEventListener('click', async (event) => {
    const queueBtn = event.target.closest('.civi-btn-queue');
    if (!queueBtn) return;
    event.preventDefault();
    const card = event.target.closest('.civi-card');
    if (!card) return;
    await handleQueue(card, { api, toast, getSettings, options });
  });
}

async function handleQuickDownload(card, ctx) {
  try {
    toggleDrawer(card, true);
    const modelId = card.dataset.modelId;
    const versionSelect = card.querySelector('.civi-version-select');
    const versionId = versionSelect ? versionSelect.value : card.dataset.versionId;
    const settings = ctx.getSettings();
    const payload = {
      model_url_or_id: modelId,
      model_version_id: versionId ? Number(versionId) : null,
      api_key: settings?.apiKey || '',
    };
    const details = await ctx.api.getModelDetails(payload);
    if (!details || details.success === false) {
      const message = details?.details || details?.error || 'Failed to load model details';
      ctx.toast(message, 'error');
      return;
    }

    const modelTypeOptions = ctx.getModelTypeOptions();
    const inferred = ctx.inferModelType(details.model_type || card.dataset.modelType);
    const defaults = {
      modelType: inferred || settings?.defaultModelType || card.dataset.modelType || '',
      subdir: '',
      filename: '',
    };
    if (defaults.modelType) card.dataset.modelType = defaults.modelType;
    if (details.version_id) card.dataset.versionId = details.version_id;
    populateDrawerWithDetails(card, details, modelTypeOptions, defaults);
    if (versionSelect && details.version_id) {
      versionSelect.value = String(details.version_id);
    }

    if (typeof ctx.options.onDetailsLoaded === 'function') {
      ctx.options.onDetailsLoaded(card, details);
    }

    if (ctx.options.getLocalInfo) {
      try {
        const info = await ctx.options.getLocalInfo({
          modelId,
          versionId: details.version_id || versionId,
        });
        renderLocalInfo(card, info);
      } catch (err) {
        // ignore missing endpoint
      }
    }
  } catch (error) {
    console.error('Quick download error', error);
    ctx.toast('Failed to load download options', 'error');
  }
}

async function handleDetails(card, ctx) {
  try {
    const modelId = card.dataset.modelId;
    const versionSelect = card.querySelector('.civi-version-select');
    const versionId = versionSelect ? versionSelect.value : card.dataset.versionId;
    const settings = ctx.getSettings();
    const payload = {
      model_url_or_id: modelId,
      model_version_id: versionId ? Number(versionId) : null,
      api_key: settings?.apiKey || '',
    };
    const details = await ctx.api.getModelDetails(payload);
    if (!details || details.success === false) {
      const message = details?.details || details?.error || 'Failed to load details';
      ctx.toast(message, 'error');
      return;
    }
    if (typeof ctx.options?.onShowDetails === 'function') {
      ctx.options.onShowDetails(details, card);
    } else {
      ctx.toast('Details loaded. Integrate preview modal to show them.', 'info');
      console.info('[Civicomfy] Details payload', details);
    }
  } catch (error) {
    console.error('Details error', error);
    ctx.toast('Failed to open details', 'error');
  }
}

async function handleQueue(card, ctx) {
  try {
    const settings = ctx.getSettings();
    if (!settings?.apiKey) {
      ctx.toast('API key required. Set it in Settings.', 'error');
      if (typeof ctx.options.onRequireApiKey === 'function') {
        ctx.options.onRequireApiKey();
      }
      return;
    }
    const payload = buildPayloadFromDrawer(card, settings);
    if (!payload) {
      ctx.toast('Please select a file or version to download.', 'error');
      return;
    }
    const response = await ctx.api.queueDownload(payload);
    if (response?.status === 'exists' || response?.status === 'exists_size_mismatch') {
      ctx.toast(response.message || 'Model already downloaded.', 'info');
      toggleDrawer(card, false);
      return;
    }
    if (!response || response.status !== 'queued') {
      const message = response?.message || 'Download did not queue';
      ctx.toast(message, 'error');
      return;
    }
    const queueId = response.download_id || response.queueId;
    if (!queueId) {
      ctx.toast('Queue response missing download id', 'error');
      return;
    }
    attachQueueId(card, queueId);
    ctx.toast('Download queued', 'success');
    toggleDrawer(card, false);
    startStatusPolling(card, queueId, ctx);
    if (typeof ctx.options.onQueueSuccess === 'function') {
      ctx.options.onQueueSuccess(queueId, response, card);
    }
  } catch (error) {
    console.error('Queue error', error);
    ctx.toast(error?.details || error?.message || 'Queue failed', 'error');
  }
}

function buildPayloadFromDrawer(card, settings) {
  const modelId = card.dataset.modelId;
  if (!modelId) return null;
  const versionSelect = card.querySelector('.civi-version-select');
  const versionId = versionSelect && versionSelect.value ? Number(versionSelect.value) : undefined;
  const fileRadio = card.querySelector('.civi-file-radio:checked');
  const fileId = fileRadio ? Number(fileRadio.value) : undefined;
  const modelType = card.querySelector('.civi-target-root')?.value || card.dataset.modelType || settings?.defaultModelType || '';
  const subdir = card.querySelector('.civi-subdir-input')?.value?.trim() || '';
  const filename = card.querySelector('.civi-filename-input')?.value?.trim() || '';
  const force = !!card.querySelector('.civi-force-checkbox')?.checked;

  return {
    model_url_or_id: modelId,
    model_version_id: Number.isFinite(versionId) ? versionId : undefined,
    file_id: Number.isFinite(fileId) ? fileId : undefined,
    model_type: modelType,
    subdir,
    custom_filename: filename || undefined,
    num_connections: settings?.numConnections || 1,
    force_redownload: force,
    api_key: settings?.apiKey || '',
  };
}

function attachQueueId(card, queueId) {
  card.dataset.queueId = queueId;
  let badge = card.querySelector('.civi-queued-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'civi-queued-badge';
    const meta = card.querySelector('.civi-meta');
    if (meta) meta.appendChild(badge);
  }
  badge.textContent = 'Queued';
}

function startStatusPolling(card, queueId, ctx) {
  const poll = async () => {
    try {
      const status = await ctx.api.getStatus();
      const entry = findEntryById(status, queueId);
      if (entry) {
        renderStatusOnCard(card, entry, ctx);
        if (['completed', 'failed', 'cancelled'].includes(entry.status)) {
          finalizeBadge(card, entry.status, ctx);
          return;
        }
      } else if (status && Array.isArray(status.history)) {
        const historyEntry = status.history.find(item => item.id === queueId);
        if (historyEntry) {
          renderStatusOnCard(card, historyEntry, ctx);
          finalizeBadge(card, historyEntry.status || 'completed', ctx);
          return;
        }
      }
    } catch (error) {
      console.error('Status poll error', error);
    }
    card.__civiStatusTimer = setTimeout(poll, POLL_INTERVAL);
  };
  if (card.__civiStatusTimer) clearTimeout(card.__civiStatusTimer);
  poll();
}

function renderStatusOnCard(card, status, ctx) {
  let bar = card.querySelector('.civi-progress');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'civi-progress';
    const actions = card.querySelector('.civi-actions');
    (actions || card).appendChild(bar);
  }
  const progress = Number.isFinite(status?.progress) ? Math.max(0, Math.min(100, status.progress)) : 0;
  const speed = Number(status?.speed) > 0 ? `${formatBytes(status.speed)}/s` : '';
  bar.style.setProperty('--civi-progress', `${progress}%`);
  bar.textContent = `${Math.round(progress)}%${speed ? ` • ${speed}` : ''}`;
  if (status?.status === 'failed') {
    bar.classList.add('failed');
  }
}

function finalizeBadge(card, state, ctx) {
  if (card.__civiStatusTimer) {
    clearTimeout(card.__civiStatusTimer);
    card.__civiStatusTimer = null;
  }
  const badge = card.querySelector('.civi-queued-badge');
  if (!badge) return;
  if (state === 'completed') {
    badge.textContent = 'Done';
    ctx.toast('Download finished', 'success');
  } else if (state === 'failed') {
    badge.textContent = 'Failed';
    ctx.toast('Download failed', 'error');
  } else if (state === 'cancelled') {
    badge.textContent = 'Cancelled';
    ctx.toast('Download cancelled', 'info');
  } else {
    badge.textContent = state;
  }
}

function findEntryById(status, queueId) {
  if (!status) return null;
  const lists = ['active', 'queue'];
  for (const key of lists) {
    const arr = status[key];
    if (Array.isArray(arr)) {
      const found = arr.find(item => item.id === queueId);
      if (found) return found;
    }
  }
  return null;
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
