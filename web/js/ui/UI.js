import { Feedback } from "./feedback.js";
import { setupEventListeners } from "./handlers/eventListeners.js";
import { handleSearchSubmit, initSearchHandlers } from "./handlers/searchHandler.js";
import { handleSettingsSave, loadAndApplySettings, loadSettingsFromCookie, saveSettingsToCookie, applySettings, getDefaultSettings } from "./handlers/settingsHandler.js";
import { startStatusUpdates, stopStatusUpdates, updateStatus, handleCancelDownload, handleRetryDownload, handleOpenPath, handleClearHistory } from "./handlers/statusHandler.js";
import { renderSearchResults as renderSearchCards } from "./searchRenderer.js";
import { renderDownloadList } from "./statusRenderer.js";
import { renderLibraryList } from "./libraryRenderer.js";
import { modalTemplate } from "./templates.js";
import { CivitaiDownloaderAPI } from "../api/civitai.js";

export class CivitaiDownloaderUI {
    constructor() {
        this.modal = null;
        this.tabs = {};
        this.tabContents = {};
        this.activeTab = 'library';
        this.modelTypes = {};
        this.statusInterval = null;
        this.statusData = { queue: [], active: [], history: [] };
        this.baseModels = [];
        this.searchPagination = { currentPage: 1, totalPages: 1, limit: 20 };
        this.settings = this.getDefaultSettings();
        this.toastTimeout = null;
        this.libraryItems = [];
        this.libraryLoaded = false;
        this.libraryLoading = false;
        this.librarySearchTimeout = null;

        this.updateStatus();
        this.buildModalHTML();
        this.cacheDOMElements();
        this.setupEventListeners();
        this.feedback = new Feedback(this.modal.querySelector('#civitai-toast'));
        // Ensure icon stylesheet is loaded so buttons render icons immediately
        this.ensureFontAwesome();
        this.initializeSearchHandlers();
    }

    // --- Core UI Methods ---
    buildModalHTML() {
        this.modal = document.createElement('div');
        this.modal.className = 'civitai-downloader-modal';
        this.modal.id = 'civitai-downloader-modal';
        this.modal.innerHTML = modalTemplate(this.settings);
    }

    cacheDOMElements() {
        this.closeButton = this.modal.querySelector('#civitai-close-modal');
        this.tabContainer = this.modal.querySelector('.civitai-downloader-tabs');

        // Library Tab
        this.libraryContent = this.modal.querySelector('#civitai-tab-library');
        this.libraryListContainer = this.modal.querySelector('#civitai-library-list');
        this.librarySearchInput = this.modal.querySelector('#civitai-library-search');
        this.libraryRefreshButton = this.modal.querySelector('#civitai-library-refresh');
        this.libraryCountLabel = this.modal.querySelector('#civitai-library-count');

        // Search Tab
        this.searchForm = this.modal.querySelector('#civitai-search-form');
        this.searchQueryInput = this.modal.querySelector('#civitai-search-query');
        this.searchTypeSelect = this.modal.querySelector('#civitai-search-type');
        this.searchBaseModelSelect = this.modal.querySelector('#civitai-search-base-model');
        this.searchSortSelect = this.modal.querySelector('#civitai-search-sort');
        this.searchPeriodSelect = this.modal.querySelector('#civitai-search-period');
        this.searchSubmitButton = this.modal.querySelector('#civitai-search-submit');
        this.searchResultsContainer = this.modal.querySelector('#civitai-search-results');
        this.searchPaginationContainer = this.modal.querySelector('#civitai-search-pagination');

        // Status Tab
        this.statusContent = this.modal.querySelector('#civitai-status-content');
        this.activeListContainer = this.modal.querySelector('#civitai-active-list');
        this.queuedListContainer = this.modal.querySelector('#civitai-queued-list');
        this.historyListContainer = this.modal.querySelector('#civitai-history-list');
        this.statusIndicator = this.modal.querySelector('#civitai-status-indicator');
        this.activeCountSpan = this.modal.querySelector('#civitai-active-count');
        this.clearHistoryButton = this.modal.querySelector('#civitai-clear-history-button');
        this.confirmClearModal = this.modal.querySelector('#civitai-confirm-clear-modal');
        this.confirmClearYesButton = this.modal.querySelector('#civitai-confirm-clear-yes');
        this.confirmClearNoButton = this.modal.querySelector('#civitai-confirm-clear-no');

        // Settings Tab
        this.settingsForm = this.modal.querySelector('#civitai-settings-form');
        this.settingsApiKeyInput = this.modal.querySelector('#civitai-settings-api-key');
        this.settingsConnectionsInput = this.modal.querySelector('#civitai-settings-connections');
        this.settingsDefaultTypeSelect = this.modal.querySelector('#civitai-settings-default-type');
        this.settingsAutoOpenCheckbox = this.modal.querySelector('#civitai-settings-auto-open-status');
        this.settingsHideMatureCheckbox = this.modal.querySelector('#civitai-settings-hide-mature');
        this.settingsMergedUiCheckbox = this.modal.querySelector('#civitai-settings-merged-ui');
        this.settingsNsfwThresholdInput = this.modal.querySelector('#civitai-settings-nsfw-threshold');
        this.settingsSaveButton = this.modal.querySelector('#civitai-settings-save');

        // Toast Notification
        this.toastElement = this.modal.querySelector('#civitai-toast');

        // Collect tabs and contents
        this.tabs = {};
        this.modal.querySelectorAll('.civitai-downloader-tab').forEach(tab => {
            this.tabs[tab.dataset.tab] = tab;
        });
        this.tabContents = {};
        this.modal.querySelectorAll('.civitai-downloader-tab-content').forEach(content => {
            const tabName = content.id.replace('civitai-tab-', '');
            if (tabName) this.tabContents[tabName] = content;
        });
    }

    async initializeUI() {
        console.info("[Civicomfy] Initializing UI components...");
        await this.populateModelTypes();
        await this.populateBaseModels();
        this.loadAndApplySettings();
        await this.loadLibraryItems(true);
    }

    async populateModelTypes() {
        console.log("[Civicomfy] Populating model types...");
        try {
            const types = await CivitaiDownloaderAPI.getModelTypes();
            if (!types || typeof types !== 'object' || Object.keys(types).length === 0) {
                 throw new Error("Received invalid model types data format.");
            }
            this.modelTypes = types;
            const sortedTypes = Object.entries(this.modelTypes).sort((a, b) => a[1].localeCompare(b[1]));

            this.searchTypeSelect.innerHTML = '<option value="any">Any Type</option>';
            this.settingsDefaultTypeSelect.innerHTML = '';

            sortedTypes.forEach(([key, displayName]) => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = displayName;
                this.settingsDefaultTypeSelect.appendChild(option.cloneNode(true));
                this.searchTypeSelect.appendChild(option.cloneNode(true));
            });
        } catch (error) {
            console.error("[Civicomfy] Failed to get or populate model types:", error);
            this.showToast('Failed to load model types', 'error');
            this.searchTypeSelect.innerHTML = '<option value="any">Any Type</option><option value="checkpoint">Checkpoint (Default)</option>';
            this.settingsDefaultTypeSelect.innerHTML = '<option value="checkpoint">Checkpoint (Default)</option>';
            this.modelTypes = { "checkpoint": "Checkpoint (Default)" };
        }
    }

    // (loadAndPopulateRoots removed; dynamic types already reflect models/ subfolders)

    async populateBaseModels() {
        console.log("[Civicomfy] Populating base models...");
        try {
            const result = await CivitaiDownloaderAPI.getBaseModels();
            if (!result || !Array.isArray(result.base_models)) {
                throw new Error("Invalid base models data format received.");
            }
            this.baseModels = result.base_models.sort();
            const existingOptions = Array.from(this.searchBaseModelSelect.options);
            existingOptions.slice(1).forEach(opt => opt.remove());
            this.baseModels.forEach(baseModelName => {
                const option = document.createElement('option');
                option.value = baseModelName;
                option.textContent = baseModelName;
                this.searchBaseModelSelect.appendChild(option);
            });
        } catch (error) {
             console.error("[Civicomfy] Failed to get or populate base models:", error);
             this.showToast('Failed to load base models list', 'error');
        }
    }

    switchTab(tabId) {
        if (this.activeTab === tabId || !this.tabs[tabId] || !this.tabContents[tabId]) return;

        this.tabs[this.activeTab]?.classList.remove('active');
        this.tabContents[this.activeTab]?.classList.remove('active');

        this.tabs[tabId].classList.add('active');
        this.tabContents[tabId].classList.add('active');
        this.tabContents[tabId].scrollTop = 0;
        this.activeTab = tabId;

        if (tabId === 'status') {
            this.updateStatus();
        } else if (tabId === 'settings') {
            this.applySettings();
        } else if (tabId === 'library') {
            if (this.libraryLoaded) {
                this.applyLibraryFilter();
            } else {
                this.loadLibraryItems(true);
            }
        }
    }

    // --- Modal Control ---
    openModal() {
        this.modal?.classList.add('open');
        document.body.style.setProperty('overflow', 'hidden', 'important');
        this.startStatusUpdates();
        if (this.activeTab === 'status') this.updateStatus();
        if (this.activeTab === 'library') this.loadLibraryItems(!this.libraryLoaded);
        if (!this.settings.apiKey) this.switchTab('settings');
    }

    closeModal() {
        this.modal?.classList.remove('open');
        document.body.style.removeProperty('overflow');
        this.stopStatusUpdates();
    }

    // --- Utility Methods ---
    formatBytes(bytes, decimals = 2) {
        if (bytes === null || bytes === undefined || isNaN(bytes)) return 'N/A';
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    formatSpeed(bytesPerSecond) {
        if (!isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
        return this.formatBytes(bytesPerSecond) + '/s';
    }

    formatDuration(isoStart, isoEnd) {
        try {
            const diffSeconds = Math.round((new Date(isoEnd) - new Date(isoStart)) / 1000);
            if (isNaN(diffSeconds) || diffSeconds < 0) return 'N/A';
            if (diffSeconds < 60) return `${diffSeconds}s`;
            const diffMinutes = Math.floor(diffSeconds / 60);
            const remainingSeconds = diffSeconds % 60;
            return `${diffMinutes}m ${remainingSeconds}s`;
        } catch (e) {
            return 'N/A';
        }
    }

    showToast(message, type = 'info', duration = 3000) {
        this.feedback?.show(message, type, duration);
    }

    ensureFontAwesome() {
        this.feedback?.ensureFontAwesome();
    }

    initializeSearchHandlers() {
        if (!this.searchResultsContainer) return;
        initSearchHandlers(this.searchResultsContainer, {
            api: CivitaiDownloaderAPI,
            toast: (message, type = 'info', duration = 3000) => this.showToast(message, type, duration),
            getSettings: () => this.settings,
            getModelTypeOptions: () => {
                const entries = Object.entries(this.modelTypes || {});
                if (entries.length === 0) {
                    const fallback = this.settings?.defaultModelType || 'checkpoint';
                    return [{ value: fallback, label: this.modelTypes?.[fallback] || fallback }];
                }
                return entries.map(([value, label]) => ({ value, label }));
            },
            inferModelType: (type) => this.inferFolderFromCivitaiType(type),
            onQueueSuccess: () => {
                this.libraryLoaded = false;
                if (this.settings.autoOpenStatusTab) {
                    this.switchTab('status');
                } else {
                    this.updateStatus();
                }
            },
            onRequireApiKey: () => this.switchTab('settings'),
        });
    }

    async loadLibraryItems(showLoading = false) {
        if (!this.libraryListContainer) return;
        if (this.libraryLoading) return;
        this.libraryLoading = true;

        if (showLoading) {
            this.libraryListContainer.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Loading library...</p>';
            this.ensureFontAwesome();
        }

        try {
            const response = await CivitaiDownloaderAPI.getLibrary();
            if (!response || !Array.isArray(response.items)) {
                throw new Error('Invalid library response');
            }
            this.libraryItems = response.items.filter(item => item && item.deleted !== true);
            this.libraryLoaded = true;
            this.applyLibraryFilter();
        } catch (error) {
            const message = error.details || error.message || 'Failed to load library.';
            console.error('[Civicomfy] Failed to load library:', error);
            if (this.libraryListContainer) {
                this.libraryListContainer.innerHTML = `<p style="color: var(--error-text, #ff6b6b);">${message}</p>`;
            }
            this.libraryItems = [];
            this.updateLibraryCount(0);
            this.showToast(message, 'error', 5000);
        } finally {
            this.libraryLoading = false;
        }
    }

    applyLibraryFilter() {
        if (!Array.isArray(this.libraryItems)) {
            this.renderLibraryList([]);
            this.updateLibraryCount(0);
            return;
        }
        const query = (this.librarySearchInput?.value || '').trim().toLowerCase();
        let filtered = this.libraryItems;
        if (query) {
            filtered = this.libraryItems.filter(item => {
                const fields = [
                    item?.model_name,
                    item?.version_name,
                    item?.filename,
                    item?.model_type,
                    item?.path,
                ];
                if (Array.isArray(item?.trained_words)) fields.push(...item.trained_words);
                if (Array.isArray(item?.tags)) fields.push(...item.tags);
                return fields.some(field => typeof field === 'string' && field.toLowerCase().includes(query));
            });
        }
        this.renderLibraryList(filtered);
        this.updateLibraryCount(filtered.length);
    }

    updateLibraryCount(count) {
        if (!this.libraryCountLabel) return;
        const total = Array.isArray(this.libraryItems) ? this.libraryItems.length : 0;
        const suffix = count === 1 ? 'model' : 'models';
        if (total > 0 && count !== total) {
            this.libraryCountLabel.textContent = `${count.toLocaleString()} ${suffix} of ${total.toLocaleString()}`;
        } else {
            this.libraryCountLabel.textContent = `${count.toLocaleString()} ${suffix}`;
        }
    }

    async handleDeleteLibraryItem(downloadId, button) {
        if (!downloadId) return;
        if (!window.confirm('Delete this model from disk? This action cannot be undone.')) {
            return;
        }

        const originalIcon = button?.innerHTML;
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const result = await CivitaiDownloaderAPI.deleteLibraryItem(downloadId);
            if (result?.success) {
                this.showToast(result.message || 'Model removed from disk.', 'success');
                this.libraryItems = Array.isArray(this.libraryItems)
                    ? this.libraryItems.filter(item => item && item.id !== downloadId)
                    : [];
                this.applyLibraryFilter();
                this.libraryLoaded = true;
                this.updateStatus();
            } else {
                const message = result?.error || 'Failed to delete model.';
                this.showToast(message, 'error', 5000);
            }
        } catch (error) {
            const message = error.details || error.message || 'Failed to delete model.';
            console.error('[Civicomfy] Delete library item failed:', error);
            this.showToast(message, 'error', 5000);
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = originalIcon || '<i class="fas fa-trash-alt"></i>';
            }
        }
    }

    updateMergedUIState() {
        const enabled = this.settings?.mergedSearchDownloadUI === true;
        const downloadTab = this.tabs?.['download'];
        const downloadContent = this.tabContents?.['download'];
        if (downloadTab) {
            downloadTab.style.display = enabled ? 'none' : '';
            if (enabled) {
                downloadTab.classList.remove('active');
                downloadTab.setAttribute('aria-hidden', 'true');
            } else {
                downloadTab.removeAttribute('aria-hidden');
            }
        }
        if (downloadContent) {
            downloadContent.style.display = enabled ? 'none' : '';
            if (enabled) downloadContent.classList.remove('active');
        }
        if (enabled && this.activeTab === 'download') {
            this.switchTab('search');
        }
        if (this.modal) {
            this.modal.classList.toggle('merged-ui-enabled', enabled);
        }
    }

    // --- Rendering (delegated to external renderers) ---
    renderDownloadList = (items, container, emptyMessage) => renderDownloadList(this, items, container, emptyMessage);
    renderSearchResults = (items) => {
        if (!this.searchResultsContainer) return;
        const mapped = Array.isArray(items) ? items.map((item) => this.transformSearchHit(item)).filter(Boolean) : [];
        renderSearchCards(this.searchResultsContainer, mapped);
    };
    renderLibraryList = (items) => renderLibraryList(this, items);

    // --- Auto-select model type based on Civitai model type ---
    inferFolderFromCivitaiType(civitaiType) {
        if (!civitaiType || typeof civitaiType !== 'string') return null;
        const t = civitaiType.trim().toLowerCase();
        const keys = Object.keys(this.modelTypes || {});
        if (keys.length === 0) return null;

        const exists = (k) => keys.includes(k);
        const findBy = (pred) => keys.find(pred);

        // Direct matches first
        if (exists(t)) return t;
        if (exists(`${t}s`)) return `${t}s`;

        // Common mappings from Civitai types to ComfyUI folders
        const candidates = [];
        const addIfExists = (k) => { if (exists(k)) candidates.push(k); };

        switch (t) {
            case 'checkpoint':
                addIfExists('checkpoints');
                addIfExists('models');
                break;
            case 'lora': case 'locon': case 'lycoris':
                addIfExists('loras');
                break;
            case 'vae':
                addIfExists('vae');
                break;
            case 'textualinversion': case 'embedding': case 'embeddings':
                addIfExists('embeddings');
                break;
            case 'hypernetwork':
                addIfExists('hypernetworks');
                break;
            case 'controlnet':
                addIfExists('controlnet');
                break;
            case 'unet': case 'unet2':
                addIfExists('unet');
                break;
            case 'diffusers': case 'diffusionmodels': case 'diffusion_models': case 'diffusion':
                addIfExists('diffusers');
                addIfExists('diffusion_models');
                break;
            case 'upscaler': case 'upscalers':
                addIfExists('upscale_models');
                addIfExists('upscalers');
                break;
            case 'motionmodule':
                addIfExists('motion_models');
                break;
            case 'poses':
                addIfExists('poses');
                break;
            case 'wildcards':
                addIfExists('wildcards');
                break;
            case 'onnx':
                addIfExists('onnx');
                break;
        }
        if (candidates.length > 0) return candidates[0];

        // Relaxed match: name contains type
        const contains = findBy(k => k.toLowerCase().includes(t));
        if (contains) return contains;

        return null;
    }

    transformSearchHit(hit) {
        if (!hit || typeof hit !== 'object') return null;
        const modelId = hit.id || hit.modelId;
        if (!modelId) return null;
        const versions = Array.isArray(hit.versions)
            ? hit.versions
            : (Array.isArray(hit.modelVersions) ? hit.modelVersions : []);
        const primary = hit.version || versions[0] || {};
        const fallbackBase = versions.find(v => v && v.baseModel)?.baseModel;
        const metrics = hit.metrics || hit.stats || {};
        const downloads = metrics.downloadCount ?? metrics.downloads ?? hit.downloads ?? primary.downloadCount;
        const likes = metrics.thumbsUpCount ?? metrics.likes ?? hit.likes;
        const mappedVersions = versions.map(v => ({
            id: v?.id,
            name: v?.name,
            baseModel: v?.baseModel,
        })).filter(v => v.id);

        return {
            modelId,
            versionId: primary.id,
            versionName: primary.name,
            title: hit.name || primary.name || 'Untitled Model',
            author: hit.user?.username || hit.creator || 'Unknown',
            thumbUrl: hit.thumbnailUrl || hit.previewImage || primary.thumbnailUrl || '',
            downloads,
            likes,
            baseModel: primary.baseModel || fallbackBase || '',
            modelType: hit.type || primary.type || '',
            versions: mappedVersions,
            raw: hit,
        };
    }

    renderSearchPagination(metadata) {
        if (!this.searchPaginationContainer) return;
        if (!metadata || metadata.totalPages <= 1) {
            this.searchPaginationContainer.innerHTML = '';
            this.searchPagination = { ...this.searchPagination, ...metadata };
            return;
        }

        this.searchPagination = { ...this.searchPagination, ...metadata };
        const { currentPage, totalPages, totalItems } = this.searchPagination;

        const createButton = (text, page, isDisabled = false, isCurrent = false) => {
            const button = document.createElement('button');
            button.className = `civitai-button small civitai-page-button ${isCurrent ? 'primary active' : ''}`;
            button.dataset.page = page;
            button.disabled = isDisabled;
            button.innerHTML = text;
            button.type = 'button';
            return button;
        };

        const fragment = document.createDocumentFragment();
        fragment.appendChild(createButton('&laquo; Prev', currentPage - 1, currentPage === 1));
        
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, currentPage + 2);

        if (startPage > 1) fragment.appendChild(createButton('1', 1));
        if (startPage > 2) fragment.appendChild(document.createElement('span')).textContent = '...';

        for (let i = startPage; i <= endPage; i++) {
            fragment.appendChild(createButton(i, i, false, i === currentPage));
        }

        if (endPage < totalPages - 1) fragment.appendChild(document.createElement('span')).textContent = '...';
        if (endPage < totalPages) fragment.appendChild(createButton(totalPages, totalPages));
        
        fragment.appendChild(createButton('Next &raquo;', currentPage + 1, currentPage === totalPages));

        const info = document.createElement('div');
        info.className = 'civitai-pagination-info';
        info.textContent = `Page ${currentPage} of ${totalPages} (${totalItems.toLocaleString()} models)`;
        fragment.appendChild(info);

        this.searchPaginationContainer.innerHTML = '';
        this.searchPaginationContainer.appendChild(fragment);
    }

    // --- Event Handlers and State Management (delegated to handlers) ---
    setupEventListeners = () => setupEventListeners(this);
    getDefaultSettings = () => getDefaultSettings();
    loadAndApplySettings = () => loadAndApplySettings(this);
    loadSettingsFromCookie = () => loadSettingsFromCookie(this);
    saveSettingsToCookie = () => saveSettingsToCookie(this);
    applySettings = () => applySettings(this);
    handleSettingsSave = () => handleSettingsSave(this);
    handleSearchSubmit = () => handleSearchSubmit(this);
    startStatusUpdates = () => startStatusUpdates(this);
    stopStatusUpdates = () => stopStatusUpdates(this);
    updateStatus = () => updateStatus(this);
    handleCancelDownload = (downloadId) => handleCancelDownload(this, downloadId);
    handleRetryDownload = (downloadId, button) => handleRetryDownload(this, downloadId, button);
    handleOpenPath = (downloadId, button) => handleOpenPath(this, downloadId, button);
    handleClearHistory = () => handleClearHistory(this);
}
