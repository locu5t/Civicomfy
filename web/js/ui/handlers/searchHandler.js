import { toggleDrawer, populateDrawerWithDetails, renderLocalInfo } from '../searchRenderer.js';
import { CivitaiDownloaderAPI } from '../../api/civitai.js';

const RESERVED_SEGMENTS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const CIVITAI_HOSTS = new Set(['civitai.com', 'www.civitai.com']);
const HUGGINGFACE_HOSTS = new Set(['huggingface.co', 'www.huggingface.co']);

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanBaseModelName(raw) {
  if (!raw) return '';
  let text = String(raw);
  text = text.replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function cleanModelTitle(rawTitle, baseModelName, versionName) {
  if (!rawTitle) return '';
  let text = String(rawTitle);

  text = text.replace(/\[[^\]]*\]/g, ' ');

  const cleanedBase = cleanBaseModelName(baseModelName);
  if (cleanedBase) {
    const basePattern = new RegExp(`^${escapeRegex(cleanedBase)}[\\s_-]*`, 'i');
    text = text.replace(basePattern, '');

    const parenPattern = new RegExp(`\\((?:[^)]*${escapeRegex(cleanedBase)}[^)]*)\\)`, 'i');
    text = text.replace(parenPattern, ' ');
  }

  const versionCandidates = [];
  if (versionName) {
    versionCandidates.push(String(versionName));
    const trimmed = String(versionName).replace(/^version\s+/i, '').trim();
    if (trimmed && trimmed !== versionName) versionCandidates.push(trimmed);
  }
  const uniqueVersions = Array.from(new Set(versionCandidates.filter(Boolean)));
  uniqueVersions.forEach((candidate) => {
    const pattern = new RegExp(`[\\s_-]*${escapeRegex(candidate)}$`, 'i');
    text = text.replace(pattern, '');
  });

  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

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
    const lower = segment.toLowerCase();
    if (RESERVED_SEGMENTS.has(lower)) {
      segment = `_${segment}`;
    }
    return segment;
  };

  const primary = attempt(value);
  if (primary) return primary;
  return attempt(fallback);
}

function resolveBaseModel(details, card, versionId) {
  const readBase = (source) => {
    if (!source || typeof source !== 'object') return '';
    return source.base_model || source.baseModel || '';
  };

  let base = readBase(details);

  const versionKey = versionId != null ? String(versionId) : null;
  if (!base && Array.isArray(details?.model_versions)) {
    let candidate = null;
    if (versionKey) {
      candidate = details.model_versions.find((version) => {
        if (!version) return false;
        const vid = version.id ?? version.versionId ?? version.modelVersionId;
        return vid && String(vid) === versionKey;
      });
    }
    if (!candidate) {
      candidate = details.model_versions.find((version) => readBase(version));
    }
    if (!candidate) {
      candidate = details.model_versions[0];
    }
    base = readBase(candidate);
  }

  if (!base) {
    base = readBase(details?.model_version) || readBase(details?.modelVersion);
  }

  if (!base && details?.model && typeof details.model === 'object') {
    base = readBase(details.model);
  }

  if (!base && Array.isArray(details?.versions)) {
    const candidate = details.versions.find((version) => readBase(version)) || details.versions[0];
    base = readBase(candidate);
  }

  if (!base && card?.dataset?.baseModel) {
    base = card.dataset.baseModel;
  }

  return base || '';
}

function buildAutoFolderStructure(card, details, preferredType, baseModelOverride) {
  const empty = { typeSegment: '', baseSegment: '', modelSegment: '', versionSegment: '' };
  if (!card) return empty;

  const modelId = details?.model_id || details?.modelId || card.dataset.modelId;
  const versionId = details?.version_id || details?.versionId || card.dataset.versionId;

  const preferredTypeSegment = sanitizePathSegment(preferredType, '');
  let typeSegment = preferredTypeSegment;
  if (!typeSegment) {
    typeSegment = sanitizePathSegment(
      details?.model_type || details?.type || card.dataset.modelType,
      ''
    );
  }

  const baseModelRaw = baseModelOverride || resolveBaseModel(details, card, versionId);
  if (baseModelRaw && card?.dataset) {
    card.dataset.baseModel = baseModelRaw;
  }

  const baseFallback = typeSegment ? `${typeSegment}_base` : 'base_model';
  const sanitizedOriginalBase = sanitizePathSegment(baseModelRaw, baseFallback);
  const cleanedBaseModel = cleanBaseModelName(baseModelRaw);
  const baseSegment = cleanedBaseModel
    ? sanitizePathSegment(cleanedBaseModel, sanitizedOriginalBase || baseFallback)
    : sanitizedOriginalBase;

  const rawModelName = details?.model_name || details?.model?.name || card.dataset.modelName;
  const fallbackModelSegment = sanitizePathSegment(rawModelName, modelId ? `model-${modelId}` : 'model');
  const cleanedModelTitle = cleanModelTitle(rawModelName, cleanedBaseModel || baseModelRaw, details?.version_name || details?.model_version_name || card.dataset.versionName);
  const modelSegment = cleanedModelTitle
    ? sanitizePathSegment(cleanedModelTitle, fallbackModelSegment || (modelId ? `model-${modelId}` : 'model'))
    : fallbackModelSegment;

  const versionNameRaw = details?.version_name || details?.model_version_name || card.dataset.versionName;
  const versionSegment = sanitizePathSegment(
    versionNameRaw,
    versionId ? `version-${versionId}` : 'version'
  );

  return {
    typeSegment,
    baseSegment,
    modelSegment,
    versionSegment,
  };
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

function parseHuggingFaceLookup(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;

  const direct = trimmed.replace(/^https?:\/\//i, '').replace(/^huggingface\.co\//i, '');
  if (!trimmed.includes('://') && direct.includes('/')) {
    const cleaned = direct.replace(/^\/+/, '').replace(/\.git$/i, '');
    const [owner, repo, maybeRevision] = cleaned.split('/');
    if (owner && repo) {
      const revision = maybeRevision && maybeRevision !== repo ? maybeRevision : null;
      return { repoId: `${owner}/${repo}`, revision: revision || null };
    }
  }

  let candidate = trimmed;
  if (!candidate.includes('://')) {
    candidate = `https://huggingface.co/${candidate.replace(/^\/+/, '')}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (err) {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (!HUGGINGFACE_HOSTS.has(host)) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  let repoSegments = segments.slice(0, 2);
  let remainder = segments.slice(2);
  if (segments[0].toLowerCase() === 'models' && segments.length >= 3) {
    repoSegments = segments.slice(1, 3);
    remainder = segments.slice(3);
  }

  if (repoSegments.length < 2) return null;
  const repoId = `${repoSegments[0]}/${repoSegments[1]}`;
  let revision = parsed.searchParams.get('revision') || parsed.searchParams.get('branch') || parsed.searchParams.get('ref');
  if (!revision && remainder[0]?.toLowerCase() === 'resolve' && remainder[1]) {
    revision = remainder[1];
  }

  return { repoId, revision: revision || null };
}

function buildSearchHitFromDetails(details) {
  if (!details || details.success === false) return null;

  const provider = (details.provider || '').toString().toLowerCase() || 'civitai';

  if (provider === 'huggingface') {
    const repoId = details.model_id || details.repo_id || details.huggingface?.repo_id;
    if (!repoId) return null;

    const versionId = details.version_id || details.versionId || details.huggingface?.revision || 'main';
    const versionsFromDetails = Array.isArray(details.model_versions)
      ? details.model_versions
      : [];
    let selectedVersion = versionsFromDetails.find((version) => {
      const vid = version?.id ?? version?.versionId ?? version?.revision;
      return vid && String(vid) === String(versionId);
    });
    if (!selectedVersion) {
      selectedVersion = {
        id: versionId,
        name: versionId,
        baseModel: details.base_model || '',
        type: details.model_type || '',
        revision: versionId,
      };
    }
    const versions = versionsFromDetails.length > 0 ? versionsFromDetails : [selectedVersion];

    const stats = details.stats || {};
    const metrics = {
      downloadCount: stats.downloads ?? stats.downloadCount ?? details.downloads,
      thumbsUpCount: stats.likes ?? stats.thumbsUpCount ?? details.likes,
    };

    const hit = {
      id: repoId,
      modelId: repoId,
      name: details.model_name || details.version_name || repoId,
      type: details.model_type || selectedVersion.type || '',
      metrics,
      stats: metrics,
      versions,
      version: selectedVersion,
      baseModel: details.base_model || selectedVersion.baseModel || '',
      thumbnailUrl: details.thumbnail_url || details.thumbnail || null,
      downloads: metrics.downloadCount,
      likes: metrics.thumbsUpCount,
      provider: 'huggingface',
      tags: Array.isArray(details.tags) ? details.tags : [],
      raw: { directDetails: true, provider: 'huggingface', data: details },
    };

    if (details.creator_username) {
      hit.user = { username: details.creator_username };
    }

    return hit;
  }

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
    provider: 'civitai',
    raw: { directDetails: true, data: details },
  };

  if (details.nsfw_level !== undefined && details.nsfw_level !== null) {
    hit.nsfwLevel = details.nsfw_level;
  }

  return hit;
}

export async function handleSearchSubmit(ui) {
  ui.searchSubmitButton.disabled = true;
  ui.searchSubmitButton.textContent = 'Searching...';
  ui.searchResultsContainer.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Searching...</p>';
  ui.searchPaginationContainer.innerHTML = '';
  ui.ensureFontAwesome();

  const query = ui.searchQueryInput.value.trim();
  const provider = typeof ui.getActiveProvider === 'function' ? ui.getActiveProvider() : 'civitai';

  try {
    if (provider === 'civitai') {
      const directLookup = parseModelLookup(query);
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
      return;
    }

    const hfLookup = parseHuggingFaceLookup(query);
    if (hfLookup && hfLookup.repoId) {
      try {
        const payload = {
          model_url_or_id: query,
          repo_id: hfLookup.repoId,
          revision: hfLookup.revision ?? null,
          token: ui.settings.hfToken,
          hf_token: ui.settings.hfToken,
        };
        const details = await CivitaiDownloaderAPI.getHuggingFaceDetails(payload);
        const hit = buildSearchHitFromDetails(details);
        if (hit) {
          ui.renderSearchResults([hit]);
          ui.renderSearchPagination({ totalItems: 1, totalPages: 1, currentPage: 1, pageSize: 1 });
          return;
        }
      } catch (directError) {
        console.warn('Direct Hugging Face lookup failed, proceeding with search.', directError);
      }
    }

    const params = {
      query,
      sort: ui.searchSortSelect.value,
      limit: ui.searchPagination.limit,
      page: ui.searchPagination.currentPage,
      token: ui.settings.hfToken,
      hf_token: ui.settings.hfToken,
    };

    const response = await CivitaiDownloaderAPI.searchHuggingFaceModels(params);
    if (!response || !Array.isArray(response.items)) {
      console.error('Invalid Hugging Face search response structure:', response);
      throw new Error('Received invalid data from Hugging Face search API.');
    }

    ui.renderSearchResults(response.items);
    ui.renderSearchPagination(response.metadata || { totalItems: response.items.length, totalPages: 1, currentPage: 1, pageSize: ui.searchPagination.limit });
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
    const provider = (card.dataset.provider || 'civitai').toLowerCase();
    let details;
    if (provider === 'huggingface') {
      const payload = {
        model_url_or_id: modelId,
        repo_id: modelId,
        revision: versionId || card.dataset.versionId || 'main',
        token: settings?.hfToken || '',
        hf_token: settings?.hfToken || '',
      };
      details = await ctx.api.getHuggingFaceDetails(payload);
    } else {
      const payload = {
        model_url_or_id: modelId,
        model_version_id: versionId ? Number(versionId) : null,
        api_key: settings?.apiKey || '',
      };
      details = await ctx.api.getModelDetails(payload);
    }
    if (!details || details.success === false) {
      const message = details?.details || details?.error || 'Failed to load model details';
      ctx.toast(message, 'error');
      return;
    }

    const modelTypeOptions = ctx.getModelTypeOptions();
    const resolvedVersionId = details?.version_id || details?.versionId || versionId;
    const resolvedBaseModel = resolveBaseModel(details, card, resolvedVersionId);
    if (resolvedBaseModel) {
      card.dataset.baseModel = resolvedBaseModel;
    }
    const inferred = ctx.inferModelType(details.model_type || card.dataset.modelType);
    if (details.model_name) card.dataset.modelName = details.model_name;
    if (details.version_name) card.dataset.versionName = details.version_name;
    if (details.version_id) card.dataset.versionId = details.version_id;
    if (provider === 'huggingface' && details?.huggingface?.revision) {
      card.dataset.versionId = details.huggingface.revision;
    }
    const selectedModelType = inferred || settings?.defaultModelType || card.dataset.modelType || '';
    const folderStructure = buildAutoFolderStructure(card, details, selectedModelType, resolvedBaseModel);
    const resolvedModelType = selectedModelType || folderStructure.typeSegment || '';
    const defaults = {
      modelType: resolvedModelType,
      baseFolder: folderStructure.baseSegment,
      modelFolder: folderStructure.modelSegment,
      versionFolder: folderStructure.versionSegment,
      filename: '',
    };
    if (defaults.modelType) card.dataset.modelType = defaults.modelType;
    populateDrawerWithDetails(card, details, modelTypeOptions, defaults);
    if (Array.isArray(details?.model_versions) && details.model_versions.length > 0) {
      card.__civitaiVersions = details.model_versions;
    }
    if (provider === 'huggingface') {
      card.dataset.provider = 'huggingface';
      card.__civitaiVersions = Array.isArray(details?.model_versions) && details.model_versions.length > 0
        ? details.model_versions
        : [{ id: details.version_id || 'main', name: details.version_name || 'main', revision: details.version_id || 'main' }];
    }
    if (details.thumbnail_url) {
      card.dataset.thumbnail = details.thumbnail_url;
    }
    ensurePathPreviewListeners(card);
    updatePathPreview(card);
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
    const provider = (card.dataset.provider || 'civitai').toLowerCase();
    let details;
    if (provider === 'huggingface') {
      const payload = {
        model_url_or_id: modelId,
        repo_id: modelId,
        revision: versionId || card.dataset.versionId || 'main',
        token: settings?.hfToken || '',
        hf_token: settings?.hfToken || '',
      };
      details = await ctx.api.getHuggingFaceDetails(payload);
    } else {
      const payload = {
        model_url_or_id: modelId,
        model_version_id: versionId ? Number(versionId) : null,
        api_key: settings?.apiKey || '',
      };
      details = await ctx.api.getModelDetails(payload);
    }
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
    const provider = (card.dataset.provider || 'civitai').toLowerCase();
    if (provider === 'civitai' && !settings?.apiKey) {
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
    if (typeof ctx.options.onQueueAttached === 'function') {
      ctx.options.onQueueAttached(card, queueId, response);
    }
    ctx.toast('Download queued', 'success');
    toggleDrawer(card, false);
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
  const versionValue = versionSelect && versionSelect.value ? versionSelect.value : undefined;
  const fileRadio = card.querySelector('.civi-file-radio:checked');
  const fileValue = fileRadio ? fileRadio.value : undefined;
  const modelType = card.querySelector('.civi-target-root')?.value || card.dataset.modelType || settings?.defaultModelType || '';
  const folders = collectFolderSegments(card);
  const subdirParts = [folders.baseSegment, folders.modelSegment, folders.versionSegment].filter(Boolean);
  const subdir = subdirParts.join('/');
  const filename = card.querySelector('.civi-filename-input')?.value?.trim() || '';
  const force = !!card.querySelector('.civi-force-checkbox')?.checked;
  const provider = (card.dataset.provider || 'civitai').toLowerCase();

  if (provider === 'huggingface') {
    if (!fileValue) return null;
    const filePath = fileRadio?.dataset.filePath || fileValue;
    if (!filePath) return null;
    let sizeBytes = undefined;
    if (fileRadio?.dataset.sizeBytes) {
      const parsed = Number(fileRadio.dataset.sizeBytes);
      if (Number.isFinite(parsed)) sizeBytes = parsed;
    }
    const revision = versionValue || card.dataset.versionId || 'main';
    const thumbnail = card.dataset.thumbnail || card.querySelector('.civi-thumb img')?.src || '';
    return {
      provider: 'huggingface',
      repo_id: modelId,
      model_url_or_id: modelId,
      file_path: filePath,
      file: filePath,
      revision,
      model_type: modelType,
      subdir,
      custom_filename: filename || undefined,
      num_connections: settings?.numConnections || 1,
      force_redownload: force,
      token: settings?.hfToken || '',
      hf_token: settings?.hfToken || '',
      model_name: card.dataset.modelName || modelId,
      version_name: card.dataset.versionName || revision,
      thumbnail,
      known_size: sizeBytes,
      size_bytes: sizeBytes,
    };
  }

  const versionId = versionValue ? Number(versionValue) : undefined;
  const fileId = fileValue ? Number(fileValue) : undefined;

  return {
    provider: 'civitai',
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

function collectFolderSegments(card) {
  if (!card) {
    return {
      rootValue: '',
      rootLabel: '',
      sanitizedRoot: '',
      baseSegment: '',
      modelSegment: '',
      versionSegment: '',
    };
  }

  const rootSelect = card.querySelector('.civi-target-root');
  const rawRoot = rootSelect ? rootSelect.value : card.dataset.modelType || '';
  const rootValue = typeof rawRoot === 'string' ? rawRoot.trim() : '';
  const rootLabel = rootSelect ? (rootSelect.selectedOptions[0]?.textContent || '').trim() : '';
  const sanitizedRoot = sanitizePathSegment(rootValue, '');

  const baseInput = card.querySelector('.civi-base-folder-input');
  const modelInput = card.querySelector('.civi-model-folder-input');
  const versionInput = card.querySelector('.civi-version-folder-input');

  return {
    rootValue,
    rootLabel,
    sanitizedRoot: sanitizedRoot || rootValue,
    baseSegment: sanitizePathSegment(baseInput?.value, ''),
    modelSegment: sanitizePathSegment(modelInput?.value, ''),
    versionSegment: sanitizePathSegment(versionInput?.value, ''),
  };
}

function updatePathPreview(card) {
  if (!card) return;
  const previewEl = card.querySelector('.civi-path-preview');
  if (!previewEl) return;

  const folders = collectFolderSegments(card);
  if (!folders.sanitizedRoot) {
    previewEl.textContent = 'Select a model type to see the final path.';
    return;
  }
  const parts = [];
  if (folders.sanitizedRoot) parts.push(folders.sanitizedRoot);
  if (folders.baseSegment) parts.push(folders.baseSegment);
  if (folders.modelSegment) parts.push(folders.modelSegment);
  if (folders.versionSegment) parts.push(folders.versionSegment);

  if (parts.length === 1) {
    previewEl.textContent = `models/${parts[0]}`;
    return;
  }

  if (parts.length === 0) {
    previewEl.textContent = 'Select a model type and folders to see the final path.';
    return;
  }

  previewEl.textContent = `models/${parts.join('/')}`;
}

function autoFillFolderInput(card, input, autoKey, dirtyKey, value) {
  if (!card || !input) return;
  const sanitized = sanitizePathSegment(value, '');
  input.value = sanitized || '';
  if (card.dataset) {
    if (autoKey) card.dataset[autoKey] = sanitized || '';
    if (dirtyKey) card.dataset[dirtyKey] = 'false';
  }
}

function findVersionInfo(card, versionId) {
  if (!card || !versionId) return null;
  const versions = Array.isArray(card.__civitaiVersions) ? card.__civitaiVersions : [];
  return (
    versions.find((version) => {
      if (!version) return false;
      const vid =
        version.id ??
        version.versionId ??
        version.modelVersionId ??
        version.model_version_id ??
        version.model_versionId;
      if (!vid && vid !== 0) return false;
      return String(vid) === String(versionId);
    }) || null
  );
}

function ensurePathPreviewListeners(card) {
  if (!card || card.__civiPathListenersAttached) return;
  card.__civiPathListenersAttached = true;

  const rootSelect = card.querySelector('.civi-target-root');
  const baseInput = card.querySelector('.civi-base-folder-input');
  const modelInput = card.querySelector('.civi-model-folder-input');
  const versionInput = card.querySelector('.civi-version-folder-input');
  const versionSelect = card.querySelector('.civi-version-select');

  if (rootSelect) {
    rootSelect.addEventListener('change', () => {
      if (card.dataset) {
        card.dataset.modelType = rootSelect.value || '';
      }
      updatePathPreview(card);
    });
  }

  if (baseInput) {
    baseInput.addEventListener('input', () => {
      if (card.dataset) card.dataset.userBaseFolderDirty = 'true';
      updatePathPreview(card);
    });
  }

  if (modelInput) {
    modelInput.addEventListener('input', () => {
      if (card.dataset) card.dataset.userModelFolderDirty = 'true';
      updatePathPreview(card);
    });
  }

  if (versionInput) {
    versionInput.addEventListener('input', () => {
      if (card.dataset) card.dataset.userVersionFolderDirty = 'true';
      updatePathPreview(card);
    });
  }

  if (versionSelect) {
    versionSelect.addEventListener('change', () => {
      const versionId = versionSelect.value || '';
      if (card.dataset) {
        card.dataset.versionId = versionId;
      }

      const versionInfo = findVersionInfo(card, versionId);
      const optionText = versionSelect.selectedOptions?.[0]?.textContent || '';
      const versionName =
        versionInfo?.name ||
        versionInfo?.versionName ||
        versionInfo?.model_version_name ||
        versionInfo?.modelVersionName ||
        optionText;
      if (card.dataset && versionName) {
        card.dataset.versionName = versionName;
      }

      const rootValue = rootSelect?.value || card.dataset.modelType || '';
      const sanitizedType = sanitizePathSegment(rootValue, '');
      const baseNameRaw =
        versionInfo?.baseModel ||
        versionInfo?.base_model ||
        versionInfo?.base ||
        card.dataset.baseModel ||
        '';
      if (baseNameRaw && card.dataset) {
        card.dataset.baseModel = baseNameRaw;
      }
      const baseFallback = sanitizedType ? `${sanitizedType}_base` : 'base_model';
      const baseOriginalSanitized = sanitizePathSegment(baseNameRaw, baseFallback);
      const cleanedBaseName = cleanBaseModelName(baseNameRaw);
      const baseAuto = cleanedBaseName
        ? sanitizePathSegment(cleanedBaseName, baseOriginalSanitized || baseFallback)
        : baseOriginalSanitized;
      if (card.dataset) {
        card.dataset.autoBaseFolder = baseAuto;
      }
      if (card.dataset?.userBaseFolderDirty !== 'true') {
        autoFillFolderInput(card, baseInput, 'autoBaseFolder', 'userBaseFolderDirty', baseAuto);
      }

      const versionAuto = sanitizePathSegment(versionName, versionId ? `version-${versionId}` : 'version');
      if (card.dataset) {
        card.dataset.autoVersionFolder = versionAuto;
      }
      if (card.dataset?.userVersionFolderDirty !== 'true') {
        autoFillFolderInput(card, versionInput, 'autoVersionFolder', 'userVersionFolderDirty', versionAuto);
      }

      updatePathPreview(card);
    });
  }
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

