import { toggleDrawer, populateDrawerWithDetails, renderLocalInfo } from '../searchRenderer.js';
import { CivitaiDownloaderAPI } from '../../api/civitai.js';

const RESERVED_SEGMENTS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const CIVITAI_HOSTS = new Set(['civitai.com', 'www.civitai.com']);

function sanitizePathSegment(value, fallback = '') {
  const attempt = (raw) => {
    if (raw === undefined || raw === null) return '';
    let segment = String(raw).trim();
    if (!segment) return '';
    try {
      segment = segment.normalize('NFKD');
    } catch (err) {
      // ignore lack of Unicode support
    }
    segment = segment.replace(/[\u0300-\u036f]/g, '');
    segment = segment.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
    segment = segment.replace(/\s+/g, '_');
    segment = segment.replace(/_+/g, '_');
    segment = segment.replace(/^_+|_+$/g, '');
    segment = segment.replace(/^\.+/, '').replace(/\.+$/, '');
    segment = segment.slice(0, 80);
    segment = segment.toLowerCase();
    if (RESERVED_SEGMENTS.has(segment)) {
      segment = `_${segment}`;
    }
    return segment;
  };

  const primary = attempt(value);
  if (primary) return primary;
  return attempt(fallback);
}

function buildAutoSubdir(card, details) {
  if (!card) return '';
  const modelId = details?.model_id || details?.modelId || card.dataset.modelId;
  const versionId = details?.version_id || details?.versionId || card.dataset.versionId;

  const modelSegment = sanitizePathSegment(
    details?.model_name || card.dataset.modelName,
    modelId ? `model-${modelId}` : ''
  );

  const versionSegment = sanitizePathSegment(
    details?.version_name || card.dataset.versionName,
    versionId ? `version-${versionId}` : ''
  );

  return [modelSegment, versionSegment].filter(Boolean).join('/');
}

function toInt(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const num = Number.parseInt(text, 10);
  return Number.isNaN(num) ? null : num;
}

function parseModelLookup(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { modelId: Number.parseInt(trimmed, 10), versionId: null };
  }

  let candidate = trimmed;
  if (!candidate.includes('://')) {
    candidate = `https://civitai.com/${candidate.replace(/^\/+/, '')}`;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(candidate);
  } catch (err) {
    return null;
  }

  const host = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
  if (!CIVITAI_HOSTS.has(host)) return null;

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  const segmentsLower = segments.map(segment => segment.toLowerCase());

  const findIdAfter = (tokens) => {
    for (const token of tokens) {
      const lowerToken = token.toLowerCase();
      const idx = segmentsLower.indexOf(lowerToken);
      if (idx !== -1 && segments[idx + 1]) {
        const maybeId = toInt(segments[idx + 1]);
        if (maybeId !== null) return maybeId;
      }
    }
    return null;
  };

  const modelId = findIdAfter(['models']);
  let versionId = findIdAfter(['model-versions', 'modelversions']);

  if (versionId === null) {
    versionId = toInt(parsedUrl.searchParams.get('modelVersionId') || parsedUrl.searchParams.get('modelVersion'));
  }

  if (versionId === null && parsedUrl.hash) {
    try {
      const hashParams = new URLSearchParams(parsedUrl.hash.replace(/^#/, ''));
      versionId = toInt(hashParams.get('modelVersionId') || hashParams.get('modelVersion'));
    } catch (err) {
      // ignore malformed hash params
    }
  }

  if (modelId === null && versionId === null) {
    return null;
  }

  return { modelId, versionId };
}

function buildSearchHitFromDetails(details) {
  if (!details || details.success === false) return null;

  const modelId = toInt(details.model_id) ?? details.model_id ?? null;
  const versionId = toInt(details.version_id);
  const stats = details.stats || {};

  const metrics = {
    downloadCount: stats.downloads ?? stats.downloadCount,
    thumbsUpCount: stats.likes ?? stats.thumbsUpCount,
    thumbsDownCount: stats.dislikes ?? stats.thumbsDownCount,
    tippedAmountCount: stats.buzz ?? stats.tippedAmountCount,
  };

  const versionSummary = versionId
    ? {
        id: versionId,
        name: details.version_name || `Version ${versionId}`,
        baseModel: details.base_model || '',
        type: details.model_type || '',
      }
    : null;

  const versionsFromDetails = Array.isArray(details.model_versions)
    ? details.model_versions
        .map((version) => {
          const vid = toInt(version?.id) ?? version?.id ?? version?.versionId;
          if (!vid) return null;
          return {
            id: vid,
            name: version?.name || `Version ${vid}`,
            baseModel: version?.baseModel || version?.base_model || '',
            type: version?.type || version?.model_type || '',
          };
        })
        .filter(Boolean)
    : [];

  const versions = versionsFromDetails.length > 0
    ? versionsFromDetails
    : (versionSummary ? [versionSummary] : []);

  const selectedVersion = versionId
    ? versions.find((version) => String(version.id) === String(versionId)) || versionSummary
    : versionSummary || versions[0] || null;

  const versionForHit = selectedVersion
    ? { ...selectedVersion, thumbnailUrl: details.thumbnail_url }
    : undefined;

  const inferredBaseModel = (selectedVersion && selectedVersion.baseModel)
    ? selectedVersion.baseModel
    : (details.base_model || '');

  const inferredType = (selectedVersion && selectedVersion.type)
    ? selectedVersion.type
    : (details.model_type || '');

  const hit = {
    id: modelId,
    modelId,
    name: details.model_name || details.version_name || 'Untitled Model',
    type: inferredType,
    metrics,
    stats: metrics,
    thumbnailUrl: details.thumbnail_url,
    previewImage: details.thumbnail_url,
    creator: details.creator_username || undefined,
    user: details.creator_username ? { username: details.creator_username } : undefined,
    versions,
    modelVersions: versions,
    version: versionForHit,
    baseModel: inferredBaseModel,
    raw: { directDetails: true, data: details },
  };

  if (details.nsfw_level !== undefined && details.nsfw_level !== null) {
    hit.nsfwLevel = details.nsfw_level;
  }

  return hit;
}

const POLL_INTERVAL = 3000;

export async function handleSearchSubmit(ui) {
  ui.searchSubmitButton.disabled = true;
  ui.searchSubmitButton.textContent = 'Searching...';
  ui.searchResultsContainer.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Searching...</p>';
  ui.searchPaginationContainer.innerHTML = '';
  ui.ensureFontAwesome();

  const query = ui.searchQueryInput.value.trim();
  const directLookup = parseModelLookup(query);

  try {
    if (directLookup) {
      try {
        const payload = {
          model_url_or_id: query,
          model_version_id: directLookup.versionId ?? null,
          api_key: ui.settings.apiKey,
        };
        const details = await CivitaiDownloaderAPI.getModelDetails(payload);
        const directHit = buildSearchHitFromDetails(details);
        if (!directHit) {
          const err = new Error('Model details response was missing required data.');
          err.details = 'Model details response was missing required data.';
          throw err;
        }
        ui.renderSearchResults([directHit]);
        ui.renderSearchPagination({ totalItems: 1, totalPages: 1, currentPage: 1, pageSize: 1 });
        return;
      } catch (directError) {
        console.warn('Direct model lookup failed, falling back to full search.', directError);
        if (directError?.status === 404) {
          ui.showToast(directError.details || 'Model not found. Showing regular search results instead.', 'info', 4500);
        }
      }
    }

    const params = {
      query,
      model_types: ui.searchTypeSelect.value === 'any' ? [] : [ui.searchTypeSelect.value],
      base_models: ui.searchBaseModelSelect.value === 'any' ? [] : [ui.searchBaseModelSelect.value],
      sort: ui.searchSortSelect.value,
      limit: ui.searchPagination.limit,
      page: ui.searchPagination.currentPage,
      api_key: ui.settings.apiKey,
    };

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
    if (details.model_name) card.dataset.modelName = details.model_name;
    if (details.version_name) card.dataset.versionName = details.version_name;
    if (details.version_id) card.dataset.versionId = details.version_id;
    const defaults = {
      modelType: inferred || settings?.defaultModelType || card.dataset.modelType || '',
      subdir: buildAutoSubdir(card, details),
      filename: '',
    };
    if (defaults.modelType) card.dataset.modelType = defaults.modelType;
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
