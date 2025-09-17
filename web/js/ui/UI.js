import { Feedback } from "./feedback.js";
import { setupEventListeners } from "./handlers/eventListeners.js";
import { handleSearchSubmit, initSearchHandlers } from "./handlers/searchHandler.js";
import { handleSettingsSave, loadAndApplySettings, loadSettingsFromCookie, saveSettingsToCookie, applySettings, getDefaultSettings } from "./handlers/settingsHandler.js";
import { startStatusUpdates, stopStatusUpdates, updateStatus, handleCancelDownload, handleRetryDownload, handleOpenPath } from "./handlers/statusHandler.js";
import { renderSearchResults as renderSearchCards } from "./searchRenderer.js";
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
        this.downloadIndicator = this.modal.querySelector('#civitai-download-indicator');

        // Settings Tab
        this.settingsForm = this.modal.querySelector('#civitai-settings-form');
        this.settingsApiKeyInput = this.modal.querySelector('#civitai-settings-api-key');
        this.settingsConnectionsInput = this.modal.querySelector('#civitai-settings-connections');
        this.settingsDefaultTypeSelect = this.modal.querySelector('#civitai-settings-default-type');
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

        if (tabId === 'settings') {
            this.applySettings();
        } else if (tabId === 'library') {
            if (this.libraryLoaded) {
                this.applyLibraryFilter();
            } else {
                this.loadLibraryItems(true);
            }
        } else if (tabId === 'search') {
            this.updateStatus();
        }
    }

    // --- Modal Control ---
    openModal() {
        this.modal?.classList.add('open');
        document.body.style.setProperty('overflow', 'hidden', 'important');
        this.startStatusUpdates();
        this.updateStatus();
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
            onQueueAttached: (card, queueId) => this.showQueuedStatus(card, queueId),
            onQueueSuccess: () => {
                this.libraryLoaded = false;
                this.updateStatus();
            },
            onRequireApiKey: () => this.switchTab('settings'),
        });
    }

    showQueuedStatus(card, queueId) {
        if (!card) return;
        if (queueId !== undefined && queueId !== null && card.dataset) {
            card.dataset.queueId = String(queueId);
        }
        this.syncCardStatus(card, { id: queueId, status: 'queued', progress: 0 });
    }

    updateCardStatuses(statusData = this.statusData) {
        if (!this.searchResultsContainer) return;
        if (!statusData || typeof statusData !== 'object') return;

        const statusMap = new Map();
        const addToMap = (list) => {
            if (!Array.isArray(list)) return;
            list.forEach(item => {
                if (!item || item.id === undefined || item.id === null) return;
                statusMap.set(String(item.id), item);
            });
        };

        addToMap(statusData.queue);
        addToMap(statusData.active);
        if (Array.isArray(statusData.history)) {
            statusData.history.forEach(item => {
                if (!item || item.id === undefined || item.id === null) return;
                const idStr = String(item.id);
                if (!statusMap.has(idStr)) statusMap.set(idStr, item);
            });
        }

        const cards = this.searchResultsContainer.querySelectorAll('.civi-card[data-queue-id]');
        cards.forEach(card => {
            const queueId = card.dataset.queueId;
            if (!queueId) return;
            const status = statusMap.get(queueId);
            if (status) {
                this.syncCardStatus(card, status);
            }
        });
    }

    syncCardStatus(card, status) {
        if (!card || !status) return;
        const elements = this.getCardStatusElements(card);
        if (!elements) return;
        const { footer, progress, text, error, actions } = elements;

        const downloadId = status.id ?? status.download_id ?? status.queueId ?? card.dataset?.queueId;
        if (downloadId !== undefined && downloadId !== null && card.dataset) {
            card.dataset.queueId = String(downloadId);
        }

        const rawState = ((status.status || status.state || '') + '').toLowerCase() || 'queued';
        if (card.dataset) card.dataset.downloadStatus = rawState;

        const statusLabels = {
            queued: 'Queued',
            starting: 'Starting',
            downloading: 'Downloading',
            completed: 'Completed',
            failed: 'Failed',
            cancelled: 'Cancelled',
        };
        const friendlyStatus = statusLabels[rawState] || (rawState ? rawState.charAt(0).toUpperCase() + rawState.slice(1) : 'Status');

        let progressValue = Number(status.progress);
        if (!Number.isFinite(progressValue)) {
            const percent = Number(status.percent);
            if (Number.isFinite(percent)) {
                progressValue = percent;
            } else if (rawState === 'completed') {
                progressValue = 100;
            } else {
                progressValue = 0;
            }
        }
        progressValue = Math.max(0, Math.min(100, progressValue));

        const sizeCandidates = [status.known_size, status.file_size, status.size, status.size_bytes, status.total_bytes];
        const totalBytes = sizeCandidates.map(v => Number(v)).find(v => Number.isFinite(v) && v > 0) || 0;
        const downloadedCandidates = [status.downloaded_bytes, status.downloadedBytes, status.current_size, status.bytes_downloaded];
        let downloadedBytes = downloadedCandidates.map(v => Number(v)).find(v => Number.isFinite(v) && v >= 0);
        if (!Number.isFinite(downloadedBytes) && totalBytes > 0 && Number.isFinite(progressValue)) {
            downloadedBytes = Math.min(totalBytes, Math.round(totalBytes * (progressValue / 100)));
        }

        const speedText = this.formatSpeed(status.speed);

        progress.style.setProperty('--civi-progress', `${progressValue}%`);
        progress.setAttribute('aria-valuenow', String(Math.round(progressValue)));
        progress.classList.toggle('failed', rawState === 'failed');
        progress.classList.toggle('completed', rawState === 'completed');
        progress.classList.toggle('indeterminate', rawState === 'queued' || rawState === 'starting');

        let progressLabel = friendlyStatus;
        if (rawState === 'downloading') {
            progressLabel = `${Math.round(progressValue)}%${speedText ? ` • ${speedText}` : ''}`;
        } else if (rawState === 'completed') {
            progressLabel = 'Completed';
        } else if (rawState === 'failed') {
            progressLabel = 'Failed';
        } else if (rawState === 'cancelled') {
            progressLabel = 'Cancelled';
        } else if (rawState === 'queued') {
            progressLabel = 'Queued';
        } else if (rawState === 'starting') {
            progressLabel = 'Starting';
        }
        progress.textContent = progressLabel;

        const infoParts = [];
        if (rawState === 'downloading' && totalBytes > 0 && Number.isFinite(downloadedBytes)) {
            infoParts.push(`${this.formatBytes(downloadedBytes)} / ${this.formatBytes(totalBytes)}`);
        } else if (rawState === 'completed' && totalBytes > 0) {
            infoParts.push(this.formatBytes(totalBytes));
        }
        if (rawState === 'downloading' && speedText) {
            infoParts.push(speedText);
        }
        const connection = status.connection_type || status.connectionType;
        if (connection) infoParts.push(`Conn: ${connection}`);
        if (rawState === 'completed' && status.start_time && status.end_time) {
            const duration = this.formatDuration(status.start_time, status.end_time);
            if (duration && duration !== 'N/A') infoParts.push(`Time: ${duration}`);
        }
        text.textContent = [friendlyStatus, ...infoParts].filter(Boolean).join(' • ');
        if (!text.textContent) text.textContent = friendlyStatus;

        if (status.error) {
            const errText = String(status.error);
            error.textContent = errText.length > 200 ? `${errText.slice(0, 200)}…` : errText;
            error.hidden = false;
            error.title = errText;
        } else {
            error.textContent = '';
            error.hidden = true;
            error.removeAttribute('title');
        }

        actions.innerHTML = '';
        if (downloadId !== undefined && downloadId !== null) {
            const idStr = String(downloadId);
            if (rawState === 'queued' || rawState === 'downloading' || rawState === 'starting') {
                actions.appendChild(this.createStatusActionButton('cancel', idStr));
            }
            if (rawState === 'failed' || rawState === 'cancelled') {
                actions.appendChild(this.createStatusActionButton('retry', idStr));
            }
            if (rawState === 'completed') {
                actions.appendChild(this.createStatusActionButton('open', idStr));
            }
        }
        actions.classList.toggle('hidden', actions.childElementCount === 0);

        footer.classList.remove('hidden');
        footer.setAttribute('aria-hidden', 'false');

        this.updateCardBadge(card, rawState);
        if (status.path) {
            this.updateCardLocalPath(card, status.path);
        }

        this.ensureFontAwesome();
    }

    getCardStatusElements(card) {
        if (!card) return null;
        let footer = card.querySelector('.civi-status-footer');
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'civi-status-footer hidden';
            footer.innerHTML = `
                <div class="civi-status-line">
                  <div class="civi-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">0%</div>
                  <div class="civi-status-text"></div>
                </div>
                <div class="civi-status-error" hidden></div>
                <div class="civi-status-actions"></div>
            `;
            card.appendChild(footer);
        }

        let progress = footer.querySelector('.civi-progress');
        if (!progress) {
            progress = document.createElement('div');
            progress.className = 'civi-progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            progress.setAttribute('aria-valuenow', '0');
            progress.textContent = '0%';
            const line = footer.querySelector('.civi-status-line');
            if (line) {
                line.insertBefore(progress, line.firstChild);
            } else {
                footer.insertBefore(progress, footer.firstChild);
            }
        }

        let text = footer.querySelector('.civi-status-text');
        if (!text) {
            text = document.createElement('div');
            text.className = 'civi-status-text';
            const line = footer.querySelector('.civi-status-line');
            if (line) line.appendChild(text);
            else footer.appendChild(text);
        }

        let error = footer.querySelector('.civi-status-error');
        if (!error) {
            error = document.createElement('div');
            error.className = 'civi-status-error';
            error.hidden = true;
            footer.appendChild(error);
        }

        let actions = footer.querySelector('.civi-status-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'civi-status-actions';
            footer.appendChild(actions);
        }

        return { footer, progress, text, error, actions };
    }

    createStatusActionButton(type, downloadId) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.id = downloadId;
        button.className = `civi-btn civi-status-action civi-status-action-${type}`;

        if (type === 'cancel') {
            button.innerHTML = '<i class="fas fa-times"></i> Cancel';
            button.title = 'Cancel download';
            button.setAttribute('aria-label', 'Cancel download');
        } else if (type === 'retry') {
            button.innerHTML = '<i class="fas fa-redo"></i> Retry';
            button.title = 'Retry download';
            button.setAttribute('aria-label', 'Retry download');
        } else if (type === 'open') {
            button.innerHTML = '<i class="fas fa-folder-open"></i> Open';
            button.title = 'Open containing folder';
            button.setAttribute('aria-label', 'Open containing folder');
        }

        return button;
    }

    updateCardBadge(card, state) {
        const badge = card?.querySelector('.civi-queued-badge');
        if (!badge) return;
        const labelMap = {
            queued: 'Queued',
            starting: 'Starting',
            downloading: 'Downloading',
            completed: 'Done',
            failed: 'Failed',
            cancelled: 'Cancelled',
        };
        const label = labelMap[state] || (state ? state.charAt(0).toUpperCase() + state.slice(1) : '');
        badge.textContent = label;
        badge.classList.toggle('state-success', state === 'completed');
        badge.classList.toggle('state-error', state === 'failed' || state === 'cancelled');
        badge.classList.toggle('state-active', state === 'downloading' || state === 'starting');
    }

    updateCardLocalPath(card, path) {
        if (!card) return;
        const pathEl = card.querySelector('.civi-local-path');
        if (!pathEl) return;
        const text = Array.isArray(path) ? path[0] : path;
        if (!text) return;
        pathEl.textContent = text;
        pathEl.classList.add('civi-clickable-path');
        pathEl.title = 'Open containing folder';
        if (card.dataset) card.dataset.localPath = text;
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
    renderSearchResults = (items) => {
        if (!this.searchResultsContainer) return;
        const mapped = Array.isArray(items) ? items.map((item) => this.transformSearchHit(item)).filter(Boolean) : [];
        renderSearchCards(this.searchResultsContainer, mapped);
        if (typeof this.updateCardStatuses === 'function') {
            this.updateCardStatuses(this.statusData);
        }
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
    handleCancelDownload = (downloadId, button) => handleCancelDownload(this, downloadId, button);
    handleRetryDownload = (downloadId, button) => handleRetryDownload(this, downloadId, button);
    handleOpenPath = (downloadId, button) => handleOpenPath(this, downloadId, button);
}
