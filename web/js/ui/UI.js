import { Feedback } from "./feedback.js";
import { setupEventListeners } from "./handlers/eventListeners.js";
import { handleSearchSubmit, initSearchHandlers } from "./handlers/searchHandler.js";
import { handleSettingsSave, loadAndApplySettings, loadSettingsFromCookie, saveSettingsToCookie, applySettings, getDefaultSettings } from "./handlers/settingsHandler.js";
import { startStatusUpdates, stopStatusUpdates, updateStatus, handleCancelDownload, handleRetryDownload, handleOpenPath } from "./handlers/statusHandler.js";
import { renderSearchResults as renderSearchCards } from "./searchRenderer.js";
import { showDetailsModal } from "./detailsModal.js";
import { renderLibraryList } from "./libraryRenderer.js";
import { modalTemplate } from "./templates.js";
import { CivitaiDownloaderAPI } from "../api/civitai.js";
import { createChipEditor } from "./chipEditor.js";
import { createPromptClipboard } from "./promptClipboard.js";
import { generatePromptGroupId, sanitizePromptItems } from "../utils/promptClipboard.js";

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
        this.cardMetaDrawer = null;
        this.cardMetaKeyHandler = null;
        this.cardMetaOpener = null;
        this.activeProvider = 'civitai';

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
        this.searchProviderSelect = this.modal.querySelector('#civitai-search-provider');
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
        this.settingsHfTokenInput = this.modal.querySelector('#civitai-settings-hf-token');
        this.settingsConnectionsInput = this.modal.querySelector('#civitai-settings-connections');
        this.settingsDefaultTypeSelect = this.modal.querySelector('#civitai-settings-default-type');
        this.settingsHideMatureCheckbox = this.modal.querySelector('#civitai-settings-hide-mature');
        this.settingsMergedUiCheckbox = this.modal.querySelector('#civitai-settings-merged-ui');
        this.settingsNsfwThresholdInput = this.modal.querySelector('#civitai-settings-nsfw-threshold');
        this.settingsSaveButton = this.modal.querySelector('#civitai-settings-save');

        // Node Mapping (Settings)
        this.nodeMappingTypeContainer = this.modal.querySelector('#civitai-node-mapping-type');
        this.nodeMappingBaseContainer = this.modal.querySelector('#civitai-node-mapping-base');
        this.refreshNodesButton = this.modal.querySelector('#civitai-refresh-nodes');
        this.nodeSearchTypeInput = this.modal.querySelector('#civitai-node-search-type');
        this.nodeSearchBaseInput = this.modal.querySelector('#civitai-node-search-base');

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
        this.updateProviderState();
        // Build mapping UI now that types and base models are known
        this.populateNodeMappingUI();
        if (this.nodeSearchTypeInput) this.nodeSearchTypeInput.addEventListener('input', () => this.populateNodeMappingUI());
        if (this.nodeSearchBaseInput) this.nodeSearchBaseInput.addEventListener('input', () => this.populateNodeMappingUI());
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
        this.closeCardMetaDrawer({ restoreFocus: false });
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

    formatPromptGroupTimestamp(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            if (Number.isNaN(date.getTime())) return '';
            return new Intl.DateTimeFormat(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
            }).format(date);
        } catch (error) {
            return '';
        }
    }

    sanitizeStringList(values) {
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

    sanitizePromptGroups(groups) {
        if (!Array.isArray(groups)) return [];
        const cleaned = [];
        const seen = new Set();
        groups.forEach((group) => {
            if (!group || typeof group !== 'object') return;
            const id = String(group.id || group.group_id || '').trim();
            if (!id || seen.has(id)) return;
            const name = String(group.name ?? '').trim() || 'Prompt group';
            const items = sanitizePromptItems(group.items ?? [], 256);
            if (items.length === 0) return;
            const addedAt = typeof group.added_at === 'string' ? group.added_at : '';
            const updatedAt = typeof group.updated_at === 'string' ? group.updated_at : '';
            cleaned.push({ id, name, items, added_at: addedAt, updated_at: updatedAt });
            seen.add(id);
        });
        return cleaned;
    }

    async handleAddAllToClipboard(kind, values) {
        const drawer = this.cardMetaDrawer;
        if (!drawer || !drawer.clipboard) return false;
        const sanitized = this.sanitizeStringList(values);
        if (sanitized.length === 0) {
            this.showToast(`No ${kind === 'tags' ? 'tags' : 'triggers'} found to add`, 'info');
            return true;
        }
        let action = 'loaded';
        if (!drawer.clipboard.isEmpty()) {
            const message = 'Clipboard already has items. Click OK to append or Cancel to overwrite.';
            const append = window.confirm(message);
            if (append) {
                drawer.clipboard.appendItems(sanitized);
                action = 'appended';
            } else {
                drawer.clipboard.setItems(sanitized);
                action = 'loaded';
            }
        } else {
            drawer.clipboard.setItems(sanitized);
        }
        const target = kind === 'tags' ? 'tags' : 'triggers';
        drawer.clipboard.setTarget(target);
        drawer.clipboardTarget = target;
        const label = kind === 'tags' ? 'tag' : 'trigger';
        this.showToast(
            `${action.charAt(0).toUpperCase() + action.slice(1)} ${sanitized.length} ${label}${sanitized.length === 1 ? '' : 's'} in clipboard`,
            'success',
        );
        return true;
    }

    async persistPromptGroups(cardId, groups) {
        if (!cardId) throw new Error('Missing card id');
        const payloadGroups = this.sanitizePromptGroups(groups).map((group) => ({
            id: group.id,
            name: group.name,
            items: this.sanitizeStringList(group.items),
            added_at: group.added_at,
            updated_at: group.updated_at,
        }));
        const response = await CivitaiDownloaderAPI.updateCardMeta(cardId, {
            custom_prompt_groups: payloadGroups,
        });
        if (response?.success === false) {
            throw new Error(response?.error || 'Failed to update prompt groups');
        }
        const savedCard = response?.card || {};
        return this.sanitizePromptGroups(savedCard.custom_prompt_groups ?? payloadGroups);
    }

    async handleSavePromptGroup(items) {
        const drawer = this.cardMetaDrawer;
        if (!drawer || !drawer.currentCardId) {
            this.showToast('Open a card before saving prompt groups', 'error');
            return;
        }
        const sanitized = sanitizePromptItems(items ?? [], 256);
        if (sanitized.length === 0) {
            this.showToast('Clipboard is empty', 'info');
            return;
        }
        const previewName = sanitized.slice(0, 3).join(', ').slice(0, 60);
        const suggested = previewName || 'Prompt group';
        const nameInput = window.prompt('Name for this prompt group:', suggested);
        if (nameInput === null) return;
        const name = nameInput.trim();
        if (!name) {
            this.showToast('Prompt group name cannot be empty', 'error');
            return;
        }
        const nowIso = new Date().toISOString();
        const groups = Array.isArray(drawer.promptGroups) ? [...drawer.promptGroups] : [];
        groups.unshift({
            id: generatePromptGroupId('pg'),
            name,
            items: sanitized,
            added_at: nowIso,
            updated_at: nowIso,
        });
        try {
            const saved = await this.persistPromptGroups(drawer.currentCardId, groups);
            drawer.promptGroups = saved;
            drawer.renderPromptGroups?.();
            this.updateLibraryCardMeta(
                drawer.currentCardId,
                drawer.tagsEditor.getValues(),
                drawer.triggersEditor.getValues(),
                saved,
            );
            if (drawer.currentItem) {
                drawer.currentItem.custom_prompt_groups = saved.slice();
            }
            this.showToast(`Saved prompt group "${name}"`, 'success');
        } catch (error) {
            console.error('[Civicomfy] Failed to save prompt group', error);
            this.showToast(error?.message || 'Failed to save prompt group', 'error', 5000);
        }
    }

    async renamePromptGroup(groupId) {
        const drawer = this.cardMetaDrawer;
        if (!drawer || !drawer.currentCardId) return;
        const groups = Array.isArray(drawer.promptGroups) ? [...drawer.promptGroups] : [];
        const index = groups.findIndex((group) => group.id === groupId);
        if (index === -1) return;
        const current = groups[index];
        const nameInput = window.prompt('Rename prompt group:', current.name);
        if (nameInput === null) return;
        const name = nameInput.trim();
        if (!name) {
            this.showToast('Prompt group name cannot be empty', 'error');
            return;
        }
        groups[index] = {
            ...current,
            name,
            updated_at: new Date().toISOString(),
        };
        try {
            const saved = await this.persistPromptGroups(drawer.currentCardId, groups);
            drawer.promptGroups = saved;
            drawer.renderPromptGroups?.();
            this.updateLibraryCardMeta(
                drawer.currentCardId,
                drawer.tagsEditor.getValues(),
                drawer.triggersEditor.getValues(),
                saved,
            );
            if (drawer.currentItem) {
                drawer.currentItem.custom_prompt_groups = saved.slice();
            }
            this.showToast(`Renamed prompt group to "${name}"`, 'success');
        } catch (error) {
            console.error('[Civicomfy] Failed to rename prompt group', error);
            this.showToast(error?.message || 'Failed to rename prompt group', 'error', 5000);
        }
    }

    async deletePromptGroup(groupId) {
        const drawer = this.cardMetaDrawer;
        if (!drawer || !drawer.currentCardId) return;
        const groups = Array.isArray(drawer.promptGroups) ? drawer.promptGroups : [];
        const target = groups.find((group) => group.id === groupId);
        if (!target) return;
        const confirmed = window.confirm(`Delete prompt group "${target.name}"? This cannot be undone.`);
        if (!confirmed) return;
        const remaining = groups.filter((group) => group.id !== groupId);
        try {
            const saved = await this.persistPromptGroups(drawer.currentCardId, remaining);
            drawer.promptGroups = saved;
            drawer.renderPromptGroups?.();
            this.updateLibraryCardMeta(
                drawer.currentCardId,
                drawer.tagsEditor.getValues(),
                drawer.triggersEditor.getValues(),
                saved,
            );
            if (drawer.currentItem) {
                drawer.currentItem.custom_prompt_groups = saved.slice();
            }
            this.showToast(`Deleted prompt group "${target.name}"`, 'success');
        } catch (error) {
            console.error('[Civicomfy] Failed to delete prompt group', error);
            this.showToast(error?.message || 'Failed to delete prompt group', 'error', 5000);
        }
    }

    listsEqualIgnoreCase(a, b) {
        const left = this.sanitizeStringList(Array.isArray(a) ? a : []);
        const right = this.sanitizeStringList(Array.isArray(b) ? b : []);
        if (left.length !== right.length) return false;
        for (let i = 0; i < left.length; i += 1) {
            if (left[i].toLowerCase() !== right[i].toLowerCase()) return false;
        }
        return true;
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
            onShowDetails: (details, card) => {
                try { this.ensureFontAwesome(); } catch (e) {}
                showDetailsModal(this, details, card);
            },
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

    async openDetailsForModel(modelId, versionId = null) {
        try {
            const payload = {
                model_url_or_id: modelId,
                model_version_id: versionId ? Number(versionId) : null,
                api_key: this.settings?.apiKey || '',
            };
            const details = await CivitaiDownloaderAPI.getModelDetails(payload);
            if (!details || details.success === false) {
                const message = details?.details || details?.error || 'Failed to load details';
                this.showToast(message, 'error');
                return;
            }
            try { this.ensureFontAwesome(); } catch (e) {}
            showDetailsModal(this, details, null);
        } catch (error) {
            console.error('Open details error', error);
            this.showToast(error?.details || error?.message || 'Failed to open details', 'error');
        }
    }

    async openLibraryDetails(item) {
        if (!item) return;
        const provider = (item.provider || '').toString().toLowerCase();
        if (provider === 'huggingface') {
            this.showToast('Detailed metadata is not yet available for Hugging Face downloads.', 'info');
            return;
        }
        // Prefer local offline details when available
        if (item.metadata_path) {
            try {
                const details = await CivitaiDownloaderAPI.getLocalDetails({ metadata_path: item.metadata_path });
                if (details && details.success !== false) {
                    try { this.ensureFontAwesome(); } catch (e) {}
                    showDetailsModal(this, details, null);
                    return;
                }
            } catch (e) {
                console.warn('[Civicomfy] Local details failed, falling back to online:', e);
            }
        }
        // Fallback to online call
        const mid = item.model_id || item.modelId;
        const vid = item.version_id || item.versionId;
        await this.openDetailsForModel(mid, vid ? Number(vid) : null);
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
                if (Array.isArray(item?.custom_triggers)) fields.push(...item.custom_triggers);
                if (Array.isArray(item?.custom_tags)) fields.push(...item.custom_tags);
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

    ensureCardMetaDrawer() {
        if (this.cardMetaDrawer) return this.cardMetaDrawer;
        if (!this.modal) return null;

        const container = document.createElement('div');
        container.className = 'civitai-card-meta-container';
        container.setAttribute('aria-hidden', 'true');

        const backdrop = document.createElement('div');
        backdrop.className = 'civitai-card-meta-backdrop';
        const drawer = document.createElement('aside');
        drawer.className = 'civitai-card-meta-drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-labelledby', 'civitai-card-meta-title');
        drawer.setAttribute('tabindex', '-1');

        const header = document.createElement('div');
        header.className = 'civitai-card-meta-header';
        const titleWrap = document.createElement('div');
        titleWrap.className = 'civitai-card-meta-title-wrap';
        const title = document.createElement('h3');
        title.id = 'civitai-card-meta-title';
        title.textContent = 'Edit tags & triggers';
        const subtitle = document.createElement('p');
        subtitle.className = 'civitai-card-meta-subtitle';
        titleWrap.appendChild(title);
        titleWrap.appendChild(subtitle);
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'civitai-card-meta-close';
        closeButton.setAttribute('aria-label', 'Close drawer');
        closeButton.innerHTML = '&times;';
        header.appendChild(titleWrap);
        header.appendChild(closeButton);

        const body = document.createElement('div');
        body.className = 'civitai-card-meta-body';

        const triggersSection = document.createElement('div');
        triggersSection.className = 'civitai-card-meta-section';
        const triggersEditor = createChipEditor(triggersSection, {
            title: 'Triggers',
            inputLabel: 'Add trigger',
            placeholder: 'Enter trigger and press Enter',
            addAllLabel: 'Add all triggers',
            addButtonLabel: 'Add trigger',
            helperText: 'Paste comma-separated triggers or press Enter to create a chip.',
            sourceValues: [],
            onChange: () => this.updateCardMetaDrawerState(),
            onAddAll: (values) => this.handleAddAllToClipboard('triggers', values),
        });

        const tagsSection = document.createElement('div');
        tagsSection.className = 'civitai-card-meta-section';
        const tagsEditor = createChipEditor(tagsSection, {
            title: 'Tags',
            inputLabel: 'Add tag',
            placeholder: 'Enter tag and press Enter',
            addAllLabel: 'Add all tags',
            addButtonLabel: 'Add tag',
            helperText: 'Paste comma-separated tags or press Enter to create a chip.',
            sourceValues: [],
            onChange: () => this.updateCardMetaDrawerState(),
            onAddAll: (values) => this.handleAddAllToClipboard('tags', values),
        });

        const clipboardSection = document.createElement('div');
        clipboardSection.className = 'civitai-card-meta-section civitai-card-meta-clipboard';
        const clipboardEditor = createPromptClipboard(clipboardSection, {
            targets: [
                { value: 'triggers', label: 'Custom triggers' },
                { value: 'tags', label: 'Custom tags' },
            ],
            onApply: async (items, { target }) => {
                if (target === 'tags') {
                    tagsEditor.setValues(items);
                } else {
                    triggersEditor.setValues(items);
                }
                this.updateCardMetaDrawerState();
            },
            onSaveGroup: (items) => this.handleSavePromptGroup(items),
            onToast: (message, type = 'info', duration = 3000) => this.showToast(message, type, duration),
            onTargetChange: (value) => {
                if (this.cardMetaDrawer) this.cardMetaDrawer.clipboardTarget = value;
            },
        });

        const promptGroupsSection = document.createElement('div');
        promptGroupsSection.className = 'civitai-card-meta-section civitai-card-meta-groups';
        promptGroupsSection.innerHTML = `
            <div class="civitai-prompt-groups-header">
                <h4>Prompt groups</h4>
                <p class="civitai-prompt-groups-helper">Save reusable prompt sets for this card.</p>
            </div>
            <ul class="civitai-prompt-groups-list" role="list" aria-live="polite"></ul>
        `;
        const promptGroupsList = promptGroupsSection.querySelector('.civitai-prompt-groups-list');

        const previewSection = document.createElement('div');
        previewSection.className = 'civitai-card-meta-preview';
        const previewTitle = document.createElement('h4');
        previewTitle.textContent = 'Preview on card';
        const previewTriggersWrap = document.createElement('div');
        previewTriggersWrap.className = 'civitai-card-meta-preview-group';
        const previewTriggersLabel = document.createElement('span');
        previewTriggersLabel.className = 'civitai-card-meta-preview-label';
        previewTriggersLabel.textContent = 'Custom triggers';
        const previewTriggers = document.createElement('div');
        previewTriggers.className = 'civitai-card-meta-preview-chips';
        previewTriggersWrap.appendChild(previewTriggersLabel);
        previewTriggersWrap.appendChild(previewTriggers);

        const previewTagsWrap = document.createElement('div');
        previewTagsWrap.className = 'civitai-card-meta-preview-group';
        const previewTagsLabel = document.createElement('span');
        previewTagsLabel.className = 'civitai-card-meta-preview-label';
        previewTagsLabel.textContent = 'Custom tags';
        const previewTags = document.createElement('div');
        previewTags.className = 'civitai-card-meta-preview-chips';
        previewTagsWrap.appendChild(previewTagsLabel);
        previewTagsWrap.appendChild(previewTags);

        previewSection.appendChild(previewTitle);
        previewSection.appendChild(previewTriggersWrap);
        previewSection.appendChild(previewTagsWrap);

        body.appendChild(triggersSection);
        body.appendChild(tagsSection);
        body.appendChild(clipboardSection);
        body.appendChild(promptGroupsSection);
        body.appendChild(previewSection);

        const renderPromptGroups = () => {
            if (!promptGroupsList) return;
            promptGroupsList.innerHTML = '';
            const drawerState = this.cardMetaDrawer;
            const groups = Array.isArray(drawerState?.promptGroups) ? drawerState.promptGroups : [];
            if (groups.length === 0) {
                const empty = document.createElement('li');
                empty.className = 'civitai-prompt-group-empty';
                empty.textContent = 'No prompt groups saved for this card yet.';
                promptGroupsList.appendChild(empty);
                return;
            }
            groups.forEach((group) => {
                const item = document.createElement('li');
                item.className = 'civitai-prompt-group-item';
                item.dataset.id = group.id;

                const loadButton = document.createElement('button');
                loadButton.type = 'button';
                loadButton.className = 'civitai-prompt-group-load';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'civitai-prompt-group-name';
                nameSpan.textContent = group.name;
                const metaSpan = document.createElement('span');
                metaSpan.className = 'civitai-prompt-group-meta';
                const count = group.items?.length || 0;
                const metaParts = [`${count} ${count === 1 ? 'item' : 'items'}`];
                const timestamp = this.formatPromptGroupTimestamp(group.updated_at || group.added_at);
                if (timestamp) metaParts.push(`Updated ${timestamp}`);
                metaSpan.textContent = metaParts.join(' • ');
                loadButton.appendChild(nameSpan);
                loadButton.appendChild(metaSpan);
                loadButton.addEventListener('click', () => {
                    clipboardEditor.setItems(group.items);
                    this.showToast(`Loaded "${group.name}" into clipboard`, 'success');
                });

                const actions = document.createElement('div');
                actions.className = 'civitai-prompt-group-actions';
                const applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'civitai-prompt-group-apply';
                applyBtn.textContent = 'Apply';
                applyBtn.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    clipboardEditor.setItems(group.items);
                    await clipboardEditor.apply(group.items);
                });

                const renameBtn = document.createElement('button');
                renameBtn.type = 'button';
                renameBtn.className = 'civitai-prompt-group-rename';
                renameBtn.textContent = 'Rename';
                renameBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.renamePromptGroup(group.id);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'civitai-prompt-group-delete';
                deleteBtn.textContent = 'Delete';
                deleteBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.deletePromptGroup(group.id);
                });

                actions.appendChild(applyBtn);
                actions.appendChild(renameBtn);
                actions.appendChild(deleteBtn);

                item.appendChild(loadButton);
                item.appendChild(actions);
                promptGroupsList.appendChild(item);
            });
        };

        const footer = document.createElement('div');
        footer.className = 'civitai-card-meta-footer';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'civitai-button';
        cancelButton.textContent = 'Cancel';
        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'civitai-button primary';
        saveButton.textContent = 'Save';
        saveButton.disabled = true;
        saveButton.dataset.defaultText = 'Save';
        footer.appendChild(cancelButton);
        footer.appendChild(saveButton);

        drawer.appendChild(header);
        drawer.appendChild(body);
        drawer.appendChild(footer);

        container.appendChild(backdrop);
        container.appendChild(drawer);
        this.modal.appendChild(container);

        backdrop.addEventListener('click', () => this.closeCardMetaDrawer());
        closeButton.addEventListener('click', () => this.closeCardMetaDrawer());
        cancelButton.addEventListener('click', () => this.closeCardMetaDrawer());
        saveButton.addEventListener('click', () => this.saveCardMetaDrawer());

        this.cardMetaDrawer = {
            container,
            backdrop,
            drawer,
            title,
            subtitle,
            closeButton,
            saveButton,
            cancelButton,
            triggersEditor,
            tagsEditor,
            clipboard: clipboardEditor,
            clipboardTarget: clipboardEditor.getTarget(),
            promptGroups: [],
            promptGroupsList,
            renderPromptGroups,
            previewTriggers,
            previewTags,
            currentCardId: null,
            initialValues: { triggers: [], tags: [] },
            saving: false,
        };
        return this.cardMetaDrawer;
    }

    renderCardMetaPreview() {
        const drawer = this.cardMetaDrawer;
        if (!drawer) return;
        const triggers = drawer.triggersEditor.getValues();
        const tags = drawer.tagsEditor.getValues();

        const renderGroup = (target, values) => {
            target.innerHTML = '';
            const list = this.sanitizeStringList(values);
            if (list.length === 0) {
                const empty = document.createElement('span');
                empty.className = 'civitai-card-meta-preview-empty';
                empty.textContent = 'None';
                target.appendChild(empty);
                return;
            }
            list.forEach((value) => {
                const chip = document.createElement('span');
                chip.className = 'civitai-library-pill civitai-library-pill-custom';
                chip.textContent = value;
                chip.title = 'Custom value';
                target.appendChild(chip);
            });
        };

        renderGroup(drawer.previewTriggers, triggers);
        renderGroup(drawer.previewTags, tags);
    }

    updateCardMetaDrawerState() {
        const drawer = this.cardMetaDrawer;
        if (!drawer) return;
        if (!drawer.saveButton.dataset.defaultText) {
            drawer.saveButton.dataset.defaultText = drawer.saveButton.textContent || 'Save';
        }
        if (!drawer.saving) {
            drawer.saveButton.textContent = drawer.saveButton.dataset.defaultText || 'Save';
        }
        this.renderCardMetaPreview();
        const triggers = drawer.triggersEditor.getValues();
        const tags = drawer.tagsEditor.getValues();
        const changed = !this.listsEqualIgnoreCase(triggers, drawer.initialValues.triggers)
            || !this.listsEqualIgnoreCase(tags, drawer.initialValues.tags);
        drawer.saveButton.disabled = drawer.saving || !changed;
    }

    setupCardMetaFocusTrap() {
        const drawer = this.cardMetaDrawer;
        if (!drawer) return;
        if (this.cardMetaKeyHandler) {
            drawer.container.removeEventListener('keydown', this.cardMetaKeyHandler, true);
        }
        const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        this.cardMetaKeyHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.closeCardMetaDrawer();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(drawer.container.querySelectorAll(focusableSelector))
                .filter((el) => !el.disabled && el.offsetParent !== null);
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        drawer.container.addEventListener('keydown', this.cardMetaKeyHandler, true);
    }

    removeCardMetaFocusTrap() {
        const drawer = this.cardMetaDrawer;
        if (drawer && this.cardMetaKeyHandler) {
            drawer.container.removeEventListener('keydown', this.cardMetaKeyHandler, true);
        }
        this.cardMetaKeyHandler = null;
    }

    async openCardMetaDrawer(item, openerButton) {
        if (!item || !item.id) {
            this.showToast('Missing card information', 'error');
            return;
        }
        const drawer = this.ensureCardMetaDrawer();
        if (!drawer) return;

        this.cardMetaOpener = openerButton || null;
        drawer.currentCardId = item.id;
        drawer.currentItem = item;
        drawer.saving = false;
        drawer.subtitle.textContent = item.model_name ? `Card: ${item.model_name}` : `Card ID: ${item.id}`;

        const baseTriggers = this.sanitizeStringList(item.trained_words || []);
        const baseTags = this.sanitizeStringList(item.tags || []);
        drawer.triggersEditor.setSourceValues(baseTriggers);
        drawer.tagsEditor.setSourceValues(baseTags);

        let latestMeta = null;
        try {
            latestMeta = await CivitaiDownloaderAPI.getCardMeta(item.id);
        } catch (error) {
            console.warn('[Civicomfy] Failed to load card meta:', error);
            this.showToast('Using cached metadata for this card', 'error', 4000);
        }

        const customTriggers = this.sanitizeStringList(latestMeta?.custom_triggers ?? item.custom_triggers ?? []);
        const customTags = this.sanitizeStringList(latestMeta?.custom_tags ?? item.custom_tags ?? []);
        const promptGroups = this.sanitizePromptGroups(latestMeta?.custom_prompt_groups ?? item.custom_prompt_groups ?? []);
        drawer.initialValues = {
            triggers: customTriggers.slice(),
            tags: customTags.slice(),
        };
        drawer.triggersEditor.setValues(customTriggers, true);
        drawer.tagsEditor.setValues(customTags, true);
        drawer.promptGroups = promptGroups;
        drawer.renderPromptGroups?.();
        if (drawer.clipboard) {
            drawer.clipboard.clear();
            drawer.clipboard.setTarget(drawer.clipboardTarget || 'triggers');
        }
        this.updateCardMetaDrawerState();

        drawer.container.classList.add('open');
        drawer.container.setAttribute('aria-hidden', 'false');
        this.setupCardMetaFocusTrap();
        window.requestAnimationFrame(() => {
            try { drawer.triggersEditor.focus(); } catch (_) { drawer.drawer.focus(); }
        });
    }

    closeCardMetaDrawer(options = {}) {
        const { restoreFocus = true } = options;
        const drawer = this.cardMetaDrawer;
        if (!drawer) return;
        drawer.container.classList.remove('open');
        drawer.container.setAttribute('aria-hidden', 'true');
        drawer.saveButton.disabled = true;
        drawer.saveButton.textContent = drawer.saveButton.dataset.defaultText || 'Save';
        drawer.saving = false;
        drawer.currentCardId = null;
        drawer.currentItem = null;
        drawer.initialValues = { triggers: [], tags: [] };
        drawer.promptGroups = [];
        drawer.renderPromptGroups?.();
        drawer.clipboard?.clear();
        if (drawer.subtitle) drawer.subtitle.textContent = '';
        this.removeCardMetaFocusTrap();
        if (restoreFocus && this.cardMetaOpener && typeof this.cardMetaOpener.focus === 'function') {
            try { this.cardMetaOpener.focus(); } catch (_) {}
        }
        this.cardMetaOpener = null;
    }

    updateLibraryCardMeta(cardId, customTags, customTriggers, promptGroups = null) {
        if (!Array.isArray(this.libraryItems)) return;
        const index = this.libraryItems.findIndex((entry) => entry && entry.id === cardId);
        if (index === -1) return;
        const item = this.libraryItems[index];
        item.custom_tags = this.sanitizeStringList(customTags);
        item.custom_triggers = this.sanitizeStringList(customTriggers);
        if (promptGroups !== null) {
            item.custom_prompt_groups = this.sanitizePromptGroups(promptGroups);
        }
    }

    async saveCardMetaDrawer() {
        const drawer = this.cardMetaDrawer;
        if (!drawer || !drawer.currentCardId || drawer.saving) return;
        const triggers = this.sanitizeStringList(drawer.triggersEditor.getValues());
        const tags = this.sanitizeStringList(drawer.tagsEditor.getValues());
        const promptGroups = this.sanitizePromptGroups(drawer.promptGroups);
        const changed = !this.listsEqualIgnoreCase(triggers, drawer.initialValues.triggers)
            || !this.listsEqualIgnoreCase(tags, drawer.initialValues.tags);
        if (!changed) {
            return;
        }

        drawer.saving = true;
        drawer.saveButton.disabled = true;
        drawer.saveButton.textContent = 'Saving…';

        try {
            const response = await CivitaiDownloaderAPI.updateCardMeta(drawer.currentCardId, {
                custom_triggers: triggers,
                custom_tags: tags,
                custom_prompt_groups: promptGroups,
            });
            if (response?.success === false) {
                throw new Error(response?.error || 'Failed to save metadata');
            }
            const savedCard = response?.card || {};
            const savedTriggers = this.sanitizeStringList(savedCard.custom_triggers ?? triggers);
            const savedTags = this.sanitizeStringList(savedCard.custom_tags ?? tags);
            const savedGroups = this.sanitizePromptGroups(savedCard.custom_prompt_groups ?? promptGroups);
            drawer.initialValues = { triggers: savedTriggers.slice(), tags: savedTags.slice() };
            drawer.promptGroups = savedGroups;
            drawer.renderPromptGroups?.();
            this.updateLibraryCardMeta(drawer.currentCardId, savedTags, savedTriggers, savedGroups);
            if (drawer.currentItem) {
                drawer.currentItem.custom_tags = savedTags.slice();
                drawer.currentItem.custom_triggers = savedTriggers.slice();
                drawer.currentItem.custom_prompt_groups = savedGroups.slice();
            }
            this.showToast('Tags & triggers updated', 'success');
            this.applyLibraryFilter();
            this.closeCardMetaDrawer();
        } catch (error) {
            console.error('[Civicomfy] Failed to save card meta:', error);
            const message = error?.details || error?.message || 'Failed to save card metadata';
            this.showToast(message, 'error', 5000);
            drawer.saving = false;
            this.updateCardMetaDrawerState();
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
        const provider = (hit.provider || hit.raw?.provider || 'civitai').toLowerCase();
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
            revision: v?.revision,
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
            provider,
            raw: hit,
        };
    }

    getActiveProvider() {
        if (this.searchProviderSelect) {
            return this.searchProviderSelect.value || 'civitai';
        }
        return 'civitai';
    }

    setActiveProvider(provider) {
        if (this.searchProviderSelect) {
            this.searchProviderSelect.value = provider;
        }
        this.updateProviderState();
    }

    updateProviderState() {
        const provider = this.getActiveProvider();
        this.activeProvider = provider;
        const disableTypeFilters = provider !== 'civitai';
        if (this.searchTypeSelect) {
            this.searchTypeSelect.disabled = disableTypeFilters;
            this.searchTypeSelect.classList.toggle('disabled', disableTypeFilters);
        }
        if (this.searchBaseModelSelect) {
            this.searchBaseModelSelect.disabled = disableTypeFilters;
            this.searchBaseModelSelect.classList.toggle('disabled', disableTypeFilters);
        }
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

    // --- Node mapping helpers ---
    getAvailableNodeTypes() {
        try {
            const lg = window?.LiteGraph;
            if (!lg || !lg.registered_node_types) return [];
            const keys = Object.keys(lg.registered_node_types);
            const items = keys.map(k => ({ value: k, label: k }));
            items.sort((a,b)=> a.label.localeCompare(b.label));
            return items;
        } catch (e) {
            console.warn('[Civicomfy] Failed to enumerate nodes:', e);
            return [];
        }
    }

    populateNodeMappingUI() {
        const nodes = this.getAvailableNodeTypes();
        const current = this.settings?.nodeMappings || { byType: {}, byBase: {} };
        if (this.nodeMappingTypeContainer) {
            const types = Object.entries(this.modelTypes || {});
            const frag = document.createDocumentFragment();
            const filter = (this.nodeSearchTypeInput?.value || '').toLowerCase();
            const filteredNodes = filter ? nodes.filter(n => n.label.toLowerCase().includes(filter)) : nodes;
            types.forEach(([key, label]) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap;';
                const name = document.createElement('div');
                name.style.cssText = 'flex:0 0 180px;opacity:0.9;';
                name.textContent = label || key;
                const select = document.createElement('select');
                select.className = 'civitai-select civitai-node-select-type';
                select.dataset.typeKey = key;
                const empty = document.createElement('option');
                empty.value = '';
                empty.textContent = '(none)';
                select.appendChild(empty);
                filteredNodes.forEach(n => {
                    const opt = document.createElement('option');
                    opt.value = n.value;
                    opt.textContent = n.label;
                    select.appendChild(opt);
                });
                const cur = current.byType && current.byType[key];
                const curNode = (cur && typeof cur === 'object') ? cur.node : cur;
                const curWidget = (cur && typeof cur === 'object') ? (cur.widget || '') : '';
                if (curNode) select.value = curNode;
                const widget = document.createElement('input');
                widget.type = 'text';
                widget.className = 'civitai-input civitai-widget-input-type';
                widget.placeholder = 'widget name (e.g., ckpt_name)';
                widget.dataset.typeKey = key;
                widget.value = curWidget;
                row.appendChild(name);
                row.appendChild(select);
                row.appendChild(widget);
                frag.appendChild(row);
            });
            this.nodeMappingTypeContainer.innerHTML = '';
            this.nodeMappingTypeContainer.appendChild(frag);
        }
        if (this.nodeMappingBaseContainer) {
            const bases = Array.isArray(this.baseModels) ? this.baseModels : [];
            const frag = document.createDocumentFragment();
            const filter = (this.nodeSearchBaseInput?.value || '').toLowerCase();
            const filteredNodes = filter ? nodes.filter(n => n.label.toLowerCase().includes(filter)) : nodes;
            bases.forEach((bm) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap;';
                const name = document.createElement('div');
                name.style.cssText = 'flex:0 0 180px;opacity:0.9;';
                name.textContent = bm;
                const select = document.createElement('select');
                select.className = 'civitai-select civitai-node-select-base';
                select.dataset.baseName = bm;
                const empty = document.createElement('option');
                empty.value = '';
                empty.textContent = '(none)';
                select.appendChild(empty);
                filteredNodes.forEach(n => {
                    const opt = document.createElement('option');
                    opt.value = n.value;
                    opt.textContent = n.label;
                    select.appendChild(opt);
                });
                const cur = current.byBase && current.byBase[bm];
                const curNode = (cur && typeof cur === 'object') ? cur.node : cur;
                const curWidget = (cur && typeof cur === 'object') ? (cur.widget || '') : '';
                if (curNode) select.value = curNode;
                const widget = document.createElement('input');
                widget.type = 'text';
                widget.className = 'civitai-input civitai-widget-input-base';
                widget.placeholder = 'widget name (e.g., ckpt_name)';
                widget.dataset.baseName = bm;
                widget.value = curWidget;
                row.appendChild(name);
                row.appendChild(select);
                row.appendChild(widget);
                frag.appendChild(row);
            });
            this.nodeMappingBaseContainer.innerHTML = '';
            this.nodeMappingBaseContainer.appendChild(frag);
        }
        if (this.refreshNodesButton) {
            this.refreshNodesButton.onclick = () => this.populateNodeMappingUI();
        }
    }

    readNodeMappingsFromUI() {
        const byType = {};
        const byBase = {};
        this.modal.querySelectorAll('.civitai-node-select-type').forEach(sel => {
            const key = sel.dataset.typeKey;
            if (!key) return;
            const val = sel.value || '';
            if (val) {
                const widget = this.modal.querySelector(`.civitai-widget-input-type[data-type-key="${key}"]`);
                const wval = (widget?.value || '').trim();
                byType[key] = wval ? { node: val, widget: wval } : { node: val };
            }
        });
        this.modal.querySelectorAll('.civitai-node-select-base').forEach(sel => {
            const key = sel.dataset.baseName;
            if (!key) return;
            const val = sel.value || '';
            if (val) {
                const widget = this.modal.querySelector(`.civitai-widget-input-base[data-base-name="${key}"]`);
                const wval = (widget?.value || '').trim();
                byBase[key] = wval ? { node: val, widget: wval } : { node: val };
            }
        });
        return { byType, byBase };
    }

    async addToComfyUI(item) {
        const typeKey = (item?.model_type || '').toLowerCase();
        const baseKey = item?.base_model || '';
        // Prefer card-scoped single-node binding if present
        let nodeType = '';
        let widgetOverride = '';
        try {
            const meta = await CivitaiDownloaderAPI.getCardWorkflows(item.id);
            const bind = meta?.single_node_binding;
            if (bind && typeof bind === 'object' && bind.node_type) {
                nodeType = String(bind.node_type);
                widgetOverride = String(bind.widget || '');
            }
        } catch (e) {
            // ignore; fall back to settings mapping
        }
        if (!nodeType) {
            const maps = this.settings?.nodeMappings || { byType: {}, byBase: {} };
            const mapping = maps.byType?.[typeKey] || (baseKey ? maps.byBase?.[baseKey] : '');
            nodeType = (mapping && typeof mapping === 'object') ? mapping.node : mapping;
            widgetOverride = (mapping && typeof mapping === 'object') ? (mapping.widget || '') : '';
        }
        if (!nodeType) {
            this.showToast('No node mapping found. Attach a workflow binding via the card Workflow menu or set a mapping in Settings.', 'error', 6000);
            return;
        }
        const ok = this.insertNodeWithModel(nodeType, item, widgetOverride);
        if (ok) this.showToast('Added node to ComfyUI', 'success');
        else this.showToast('Failed adding node to ComfyUI. Check mapping and console.', 'error', 6000);
    }

    insertNodeWithModel(nodeType, item, widgetOverride = '') {
        try {
            const app = window?.app;
            const LG = window?.LiteGraph;
            if (!app || !LG) {
                console.warn('[Civicomfy] ComfyUI app/LiteGraph not available');
                return false;
            }
            let node = null;
            try {
                node = LG.createNode(nodeType);
            } catch (e) {
                const tail = String(nodeType).split('/').pop();
                try { node = LG.createNode(tail); } catch (_) {}
            }
            if (!node) {
                console.warn('[Civicomfy] Could not create node:', nodeType);
                return false;
            }
            // Position near selected node if any, otherwise center
            let sx = null, sy = null;
            try {
                const selected = (app.graph?._nodes || []).find(n => n?.selected);
                if (selected && Array.isArray(selected.pos)) { sx = selected.pos[0]; sy = selected.pos[1]; }
            } catch (_) {}
            const cx = (sx ?? (app.canvas?.canvas?.width || 1200) * 0.5) + (Math.random()*40-20);
            const cy = (sy ?? (app.canvas?.canvas?.height || 800) * 0.5) + (Math.random()*40-20);
            node.pos = [cx, cy];

            const filePath = item?.path || '';
            const baseName = String(filePath).split(/\\|\//).pop();
            const typeKey = (item?.model_type || '').toLowerCase();
            const widgetCandidatesByType = {
                checkpoint: ['ckpt_name','model','checkpoint','checkpoint_name'],
                lora: ['lora_name','lora','model','weight_model'],
                locon: ['lora_name','lora','model'],
                lycoris: ['lora_name','lora','model'],
                vae: ['vae_name','vae','model'],
                embedding: ['embedding_name','embedding'],
                controlnet: ['control_net_name','controlnet','model'],
                upscaler: ['upscale_model','upscaler','model'],
                unet: ['unet_name','unet','model'],
                diffusionmodels: ['model','ckpt_name'],
                other: ['model','file','path'],
            };
            const widgetNames = widgetOverride ? [String(widgetOverride)] : (widgetCandidatesByType[typeKey] || ['model','ckpt_name','lora_name']);
            const widgets = Array.isArray(node.widgets) ? node.widgets : [];
            for (const target of widgetNames) {
                const w = widgets.find(w => String(w.name||'').toLowerCase() === target);
                if (w) {
                    const values = Array.isArray(w.options?.values) ? w.options.values : null;
                    if (values && values.length) {
                        const match = values.find(v => String(v).split(/\\|\//).pop() === baseName) || values.find(v => String(v) === baseName);
                        if (match) w.value = match; else w.value = baseName;
                    } else {
                        w.value = baseName;
                    }
                    break;
                }
            }

            app.graph.add(node);
            app.graph.setDirtyCanvas(true,true);
            return true;
        } catch (e) {
            console.error('[Civicomfy] insertNodeWithModel failed', e);
            return false;
        }
    }

    // ---- Workflow Popup and Actions ----
    async openWorkflowPopup(item) {
        const existing = document.getElementById('civitai-workflow-popup');
        if (existing) existing.remove();
        const pop = document.createElement('div');
        pop.id = 'civitai-workflow-popup';
        pop.className = 'civitai-confirmation-modal';
        pop.innerHTML = `
          <div class="civitai-confirmation-modal-content" role="dialog" aria-modal="true" aria-labelledby="civi-wf-title">
            <h4 id=\"civi-wf-title\">Workflow</h4>
            <div class="civitai-form-group" style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="civitai-button primary" id="civi-wf-apply">Add a saved workflow</button>
              <button class="civitai-button" id="civi-wf-save">Save current workspace as workflow</button>
            </div>
            <div id="civi-wf-area"></div>
            <div class="civitai-confirmation-modal-actions" style="justify-content:flex-end;">
              <button class="civitai-button" id="civi-wf-close">Close</button>
            </div>
          </div>`;
        document.body.appendChild(pop);
        // Make confirmation modal visible (CSS default is display:none)
        try { pop.style.display = 'flex'; } catch (_) {}
        const close = () => pop.remove();
        pop.querySelector('#civi-wf-close')?.addEventListener('click', close);

        pop.querySelector('#civi-wf-apply')?.addEventListener('click', () => this.openApplyWorkflowUI(item, pop.querySelector('#civi-wf-area')));
        pop.querySelector('#civi-wf-save')?.addEventListener('click', () => this.openSaveWorkflowUI(item, pop.querySelector('#civi-wf-area')));
    }

    async openSaveWorkflowUI(item, container) {
        const selected = this.captureSelectedNodes();
        if (!selected || selected.node_list.length === 0) {
            container.innerHTML = '<p style="color:#ffb4b4;">Select one or more nodes in the canvas to save as a workflow.</p>';
            return;
        }
        const defaultName = `${item?.model_name || 'Workflow'} (${new Date().toLocaleString()})`;
        container.innerHTML = `
          <div class="civitai-form-group">
            <label>Workflow Name</label>
            <input type="text" id="civi-wf-name" class="civitai-input" value="${defaultName.replace(/"/g,'&quot;')}">
          </div>
          <div class="civitai-form-group">
            <div>Preview: ${selected.node_list.length} nodes, ${selected.connections.length} connections</div>
          </div>
          <div class="civitai-form-group">
            <button class="civitai-button primary" id="civi-wf-save-confirm">Save & Attach to Card</button>
          </div>`;
        container.querySelector('#civi-wf-save-confirm')?.addEventListener('click', async () => {
            const name = container.querySelector('#civi-wf-name')?.value?.trim();
            if (!name) { this.showToast('Enter a workflow name', 'error'); return; }
            try {
                const res = await CivitaiDownloaderAPI.saveWorkflow({ name, node_list: selected.node_list, connections: selected.connections, metadata: { source: 'civicomfy-ui' } });
                if (res?.workflow_id) {
                    await CivitaiDownloaderAPI.attachWorkflowToCard(item.id, res.workflow_id);
                    this.showToast('Workflow saved and attached', 'success');
                } else {
                    this.showToast('Failed to save workflow', 'error');
                }
            } catch (e) {
                this.showToast(e?.details || e?.message || 'Save failed', 'error');
            }
        });
    }

    async openApplyWorkflowUI(item, container) {
        container.innerHTML = '<p><i class="fas fa-spinner fa-spin"></i> Loading workflows...</p>';
        this.ensureFontAwesome();
        let list = [];
        try {
            const resp = await CivitaiDownloaderAPI.listWorkflows();
            list = Array.isArray(resp?.workflows) ? resp.workflows : [];
        } catch (e) {
            container.innerHTML = `<p style="color:#ffb4b4;">Failed to load workflows: ${String(e?.details||e?.message||e)}</p>`;
            return;
        }
        if (list.length === 0) {
            container.innerHTML = '<p>No saved workflows yet.</p>';
            return;
        }
        const area = document.createElement('div');
        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Search workflows...';
        search.className = 'civitai-input';
        const allowConnect = document.createElement('label');
        allowConnect.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'civi-wf-connect-existing';
        allowConnect.appendChild(cb);
        const span = document.createElement('span');
        span.textContent = 'Allow connecting to existing nodes (if workflow defines it)';
        allowConnect.appendChild(span);
        const ul = document.createElement('div');
        ul.style.cssText = 'max-height:260px;overflow:auto;border:1px solid #444;margin-top:8px;';
        const preview = document.createElement('div');
        preview.style.cssText = 'margin-top:10px;';
        area.appendChild(search);
        area.appendChild(allowConnect);
        area.appendChild(ul);
        area.appendChild(preview);

        const renderList = (items) => {
            ul.innerHTML = '';
            items.forEach((wf) => {
                const row = document.createElement('div');
                row.className = 'civitai-list-row';
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 10px;gap:10px;';
                const left = document.createElement('div');
                left.innerHTML = `<strong>${wf.name || '(unnamed)'}</strong><div style="opacity:0.7;font-size:0.9em;">${wf.node_count||0} nodes, ${wf.connection_count||0} connections</div>`;
                const applyBtn = document.createElement('button');
                applyBtn.className = 'civitai-button small';
                applyBtn.textContent = 'Preview & Add';
                applyBtn.addEventListener('click', async () => {
                    const full = await CivitaiDownloaderAPI.getWorkflow(wf.workflow_id).catch(()=>null);
                    if (!full || !full.workflow) { this.showToast('Failed to fetch workflow', 'error'); return; }
                    this.renderWorkflowPreview(full.workflow, preview, { allowConnect: cb.checked });
                });
                row.appendChild(left);
                row.appendChild(applyBtn);
                ul.appendChild(row);
            });
        };
        renderList(list);
        search.addEventListener('input', () => {
            const q = search.value.toLowerCase();
            const filtered = list.filter(x => (x.name||'').toLowerCase().includes(q));
            renderList(filtered);
        });

        container.innerHTML = '';
        container.appendChild(area);
    }

    renderWorkflowPreview(workflow, container, opts = {}) {
        const nodes = Array.isArray(workflow?.node_list) ? workflow.node_list : [];
        const conns = Array.isArray(workflow?.connections) ? workflow.connections : [];
        const refs = this.extractModelReferences(nodes);
        const unresolved = { ...refs.byName };
        // Build resolver UI
        const section = document.createElement('div');
        section.innerHTML = `
          <div><strong>Preview:</strong> ${nodes.length} nodes, ${conns.length} connections</div>
          <div style="margin-top:6px;">Model bindings found: ${Object.keys(refs.byName).length}</div>
        `;
        const resolver = document.createElement('div');
        resolver.style.cssText = 'margin:8px 0;';
        const libItemsPromise = this.ensureLibraryLoaded();
        const form = document.createElement('div');
        form.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

        const selectFor = (label, key, candidates) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:8px;align-items:center;';
            const span = document.createElement('span');
            span.textContent = label;
            const sel = document.createElement('select');
            sel.className = 'civitai-select';
            const none = document.createElement('option');
            none.value = '';
            none.textContent = '(leave unchanged)';
            sel.appendChild(none);
            candidates.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.path || c.filename || c.id;
                opt.textContent = `${c.model_name || c.filename || c.path || c.id}`;
                sel.appendChild(opt);
            });
            sel.addEventListener('change', () => { unresolved[key] = sel.value || refs.byName[key]; });
            row.appendChild(span);
            row.appendChild(sel);
            return row;
        };

        libItemsPromise.then(() => {
            const lib = Array.isArray(this.libraryItems) ? this.libraryItems : [];
            const byBase = (name) => lib.filter(i => String(i.filename||'').toLowerCase().includes(String(name).toLowerCase()) || String(i.path||'').toLowerCase().includes(String(name).toLowerCase()));
            Object.keys(refs.byName).forEach(key => {
                const candidates = byBase(key).sort((a,b) => new Date(b.downloaded_at||0) - new Date(a.downloaded_at||0));
                const row = selectFor(`Resolve '${key}' to:`, key, candidates);
                const sel = row.querySelector('select');
                if (candidates[0]) {
                    sel.value = candidates[0].path || candidates[0].filename || candidates[0].id;
                    unresolved[key] = sel.value;
                }
                form.appendChild(row);
            });
        });

        const applyBtn = document.createElement('button');
        applyBtn.className = 'civitai-button primary';
        applyBtn.textContent = 'Add Workflow to Canvas';
        applyBtn.addEventListener('click', () => {
            const replacements = unresolved; // map original->selected/unchanged
            this.applyWorkflowToWorkspace(workflow, { replacements, allowExternal: !!opts.allowConnect });
            this.showToast('Workflow nodes added', 'success');
        });

        container.innerHTML = '';
        resolver.appendChild(form);
        section.appendChild(resolver);
        section.appendChild(applyBtn);
        container.appendChild(section);
        this.ensureFontAwesome();
    }

    async ensureLibraryLoaded() {
        if (!this.libraryLoaded) {
            try { await this.loadLibraryItems(false); } catch(_) {}
        }
        return this.libraryItems;
    }

    extractModelReferences(node_list = []) {
        const byName = {};
        const candidates = ['ckpt','model','vae','lora','embedding','control','unet','file','path'];
        for (const n of node_list) {
            const w = n?.widgets || {};
            for (const [k,v] of Object.entries(w)) {
                if (typeof v === 'string') {
                    const lk = k.toLowerCase();
                    if (candidates.some(c => lk.includes(c))) {
                        const base = String(v).split(/\\|\//).pop();
                        if (base) byName[base] = base;
                    }
                }
            }
        }
        return { byName };
    }

    captureSelectedNodes() {
        try {
            const app = window?.app;
            const graph = app?.graph;
            if (!graph) return { node_list: [], connections: [] };
            const all = Array.isArray(graph._nodes) ? graph._nodes : [];
            const selected = all.filter(n => n?.selected);
            if (selected.length === 0) return { node_list: [], connections: [] };

            // Robust vec2 readers (support arrays, typed arrays, or objects with x/y)
            const readVec2 = (v) => {
                try {
                    if (v && Number.isFinite(v[0]) && Number.isFinite(v[1])) return [Number(v[0]), Number(v[1])];
                } catch (_) {}
                try {
                    if (v && Number.isFinite(v?.x) && Number.isFinite(v?.y)) return [Number(v.x), Number(v.y)];
                } catch (_) {}
                return null;
            };

            // Compute selection bounding box to normalize positions (store relative layout)
            let minX = Infinity, minY = Infinity;
            const rawPos = new Map(); // node.id -> [x,y]
            for (const n of selected) {
                const p = readVec2(n?.pos) || [0, 0];
                rawPos.set(n.id, p);
                if (p[0] < minX) minX = p[0];
                if (p[1] < minY) minY = p[1];
            }
            if (!Number.isFinite(minX)) minX = 0;
            if (!Number.isFinite(minY)) minY = 0;

            const idMap = new Map();
            const node_list = selected.map((n, idx) => {
                idMap.set(n.id, `n${idx + 1}`);
                const widgets = {};
                (Array.isArray(n.widgets) ? n.widgets : []).forEach(w => { if (w && w.name) widgets[w.name] = w.value; });
                const sz = readVec2(n?.size);
                const posAbs = rawPos.get(n.id) || [0, 0];
                const posRel = [Math.round(posAbs[0] - minX), Math.round(posAbs[1] - minY)];
                const flags = (n.flags && typeof n.flags === 'object') ? { ...n.flags } : undefined;
                const properties = (n.properties && typeof n.properties === 'object') ? { ...n.properties } : undefined;
                const mode = (typeof n.mode === 'number') ? n.mode : undefined;
                return {
                    id: idMap.get(n.id),
                    type: n.type,
                    widgets,
                    title: n.title || '',
                    pos: posRel,
                    size: sz || undefined,
                    flags,
                    properties,
                    mode,
                };
            });

            // Internal connections among selected nodes only
            const linksObj = graph.links || {};
            const connections = [];
            for (const lid in linksObj) {
                const link = linksObj[lid];
                const a = idMap.get(link.origin_id);
                const b = idMap.get(link.target_id);
                if (!a || !b) continue;
                const origin = selected.find(n => n.id === link.origin_id);
                const target = selected.find(n => n.id === link.target_id);
                const out_name = origin?.outputs?.[link.origin_slot]?.name || '';
                const in_name = target?.inputs?.[link.target_slot]?.name || '';
                connections.push({ from: a, out_index: link.origin_slot, out_name, to: b, in_index: link.target_slot, in_name });
            }

            // Optionally capture external links for later reconnection
            const external_links = [];
            for (const lid in linksObj) {
                const link = linksObj[lid];
                const a = idMap.get(link.origin_id);
                const b = idMap.get(link.target_id);
                if (a && !b) {
                    const origin = selected.find(n => n.id === link.origin_id);
                    const out_name = origin?.outputs?.[link.origin_slot]?.name || '';
                    external_links.push({ from_local_id: a, out_index: link.origin_slot, out_name, to_by_title: null, to_by_type: null, in_index: null, in_name: null });
                } else if (!a && b) {
                    const target = selected.find(n => n.id === link.target_id);
                    const in_name = target?.inputs?.[link.target_slot]?.name || '';
                    external_links.push({ from_local_id: null, out_index: null, out_name: null, to_by_title: target?.title || null, to_by_type: target?.type || null, in_index: link.target_slot, in_name });
                }
            }

            return { node_list, connections, metadata: { saved_at: new Date().toISOString(), external_links } };
        } catch (e) {
            console.warn('[Civicomfy] captureSelectedNodes failed:', e);
            return { node_list: [], connections: [] };
        }
    }

    applyWorkflowToWorkspace(workflow, options = {}) {
        try {
            const app = window?.app;
            const LG = window?.LiteGraph;
            if (!app || !LG) throw new Error('ComfyUI not ready');
            const nodes = Array.isArray(workflow?.node_list) ? workflow.node_list : [];
            const conns = Array.isArray(workflow?.connections) ? workflow.connections : [];
            const replacements = options.replacements || {};
            const created = new Map(); // local id -> node
            const offset = this._placementOffset();
            const occupied = this._gatherOccupiedRects();

            // Fallback spacing if saved workflow is missing positions (older saves)
            const hasAnyPos = nodes.some(s => Array.isArray(s?.pos) && Number.isFinite(s.pos[0]) && Number.isFinite(s.pos[1]));
            if (!hasAnyPos) {
                const colW = 240, rowH = 180, cols = 4;
                nodes.forEach((s, i) => { s.pos = [ (i % cols) * colW, Math.floor(i / cols) * rowH ]; });
            }
            for (const spec of nodes) {
                let node = null;
                try { node = LG.createNode(spec.type); } catch (_) {}
                if (!node) continue;
                const basePos = Array.isArray(spec.pos) ? spec.pos : [0,0];
                // Restore size before collision checks
                if (Array.isArray(spec.size) && spec.size.length === 2) {
                    try { node.size = [spec.size[0], spec.size[1]]; } catch (_) {}
                }
                let desired = [basePos[0] + offset[0], basePos[1] + offset[1]];
                const size = (Array.isArray(node.size) && node.size.length === 2) ? node.size : (Array.isArray(spec.size) ? spec.size : [160, 80]);
                desired = this._avoidCollision(desired, size, occupied);
                node.pos = desired;
                const widgets = Array.isArray(node.widgets) ? node.widgets : [];
                const wmap = spec.widgets || {};
                widgets.forEach(w => {
                    if (!w || !w.name) return;
                    let val = wmap[w.name];
                    if (typeof val === 'string') {
                        const base = String(val).split(/\\|\//).pop();
                        if (replacements[base]) val = replacements[base];
                    }
                    if (val !== undefined) w.value = val;
                });
                // Restore title if present
                if (spec.title && typeof spec.title === 'string') {
                    try { node.title = spec.title; } catch (_) {}
                }
                // Restore properties if present
                if (spec.properties && typeof spec.properties === 'object') {
                    node.properties = node.properties && typeof node.properties === 'object' ? node.properties : {};
                    for (const [k,v] of Object.entries(spec.properties)) {
                        try { node.properties[k] = v; } catch (_) {}
                    }
                }
                // Restore flags (e.g., collapsed/pinned/bypass)
                if (spec.flags && typeof spec.flags === 'object') {
                    node.flags = node.flags && typeof node.flags === 'object' ? node.flags : {};
                    for (const [k,v] of Object.entries(spec.flags)) {
                        try { node.flags[k] = v; } catch (_) {}
                    }
                }
                // Restore mode if numeric
                if (typeof spec.mode === 'number') {
                    try { node.mode = spec.mode; } catch (_) {}
                }
                app.graph.add(node);
                created.set(spec.id, node);
                // Track occupied rect for subsequent nodes
                occupied.push({ x: node.pos[0], y: node.pos[1], w: (node.size?.[0]||160), h: (node.size?.[1]||80) });
            }
            // Recreate connections between newly-created nodes
            for (const c of conns) {
                const a = created.get(c.from);
                const b = created.get(c.to);
                if (!a || !b) continue;
                const outIndex = Number.isFinite(c.out_index) ? c.out_index : (a.outputs||[]).findIndex(o => o?.name === c.out_name);
                const inIndex = Number.isFinite(c.in_index) ? c.in_index : (b.inputs||[]).findIndex(i => i?.name === c.in_name);
                if (outIndex >= 0 && inIndex >= 0) {
                    try { a.connect(outIndex, b, inIndex); } catch (e) { console.warn('connect failed', e); }
                }
            }
            // Optional external connections
            if (options.allowExternal && workflow?.metadata?.external_links && Array.isArray(workflow.metadata.external_links)) {
                this._connectToExisting(workflow.metadata.external_links, created);
            }
            app.graph.setDirtyCanvas(true, true);
        } catch (e) {
            console.error('[Civicomfy] applyWorkflowToWorkspace error:', e);
        }
    }

    _placementOffset() {
        try {
            const app = window?.app;
            const selected = (app?.graph?._nodes || []).find(n => n?.selected);
            if (selected && Array.isArray(selected.pos)) {
                return [Math.round(selected.pos[0] + 200 + (Math.random()*40-20)), Math.round(selected.pos[1] + (Math.random()*40-20))];
            }
            const canvas = app?.canvas?.canvas;
            const w = (canvas?.width || 1200);
            const h = (canvas?.height || 800);
            return [Math.round(w*0.5 + (Math.random()*60-30)), Math.round(h*0.5 + (Math.random()*60-30))];
        } catch (_) { return [0,0]; }
    }

    _connectToExisting(externals = [], createdMap) {
        try {
            const app = window?.app;
            const all = Array.isArray(app?.graph?._nodes) ? app.graph._nodes : [];
            const findBy = (pred) => all.find(pred);
            for (const link of externals) {
                const src = createdMap.get(link.from_local_id);
                if (!src) continue;
                const outIdx = Number.isFinite(link.out_index) ? link.out_index : (src.outputs||[]).findIndex(o => o?.name === link.out_name);
                let target = null;
                if (link.to_by_title) target = findBy(n => n?.title === link.to_by_title);
                if (!target && link.to_by_type) target = findBy(n => n?.type === link.to_by_type);
                if (!target) continue;
                const inIdx = Number.isFinite(link.in_index) ? link.in_index : (target.inputs||[]).findIndex(i => i?.name === link.in_name);
                if (outIdx>=0 && inIdx>=0) {
                    try { src.connect(outIdx, target, inIdx); } catch(e) { console.warn('external connect failed', e); }
                }
            }
        } catch (e) { console.warn('connectToExisting failed', e); }
    }

    _gatherOccupiedRects() {
        try {
            const app = window?.app;
            const nodes = Array.isArray(app?.graph?._nodes) ? app.graph._nodes : [];
            const rects = [];
            for (const n of nodes) {
                const pos = Array.isArray(n?.pos) ? n.pos : [0,0];
                const size = Array.isArray(n?.size) ? n.size : [160, 80];
                rects.push({ x: pos[0], y: pos[1], w: size[0], h: size[1] });
            }
            return rects;
        } catch (_) { return []; }
    }

    _rectsOverlap(a, b) {
        return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    }

    _avoidCollision(desiredPos, size, occupiedRects) {
        let x = Math.round(desiredPos[0]);
        let y = Math.round(desiredPos[1]);
        const w = Math.max(1, Math.round(size?.[0] || 160));
        const h = Math.max(1, Math.round(size?.[1] || 80));
        const step = 30;
        let tries = 0;
        while (tries < 400) {
            const candidate = { x, y, w, h };
            const hit = occupiedRects.some(r => this._rectsOverlap(candidate, r));
            if (!hit) return [x, y];
            x += step; y += step; // diagonal shift
            tries++;
            if (tries % 20 === 0) { x += 10; y -= 5; } // wiggle to escape tight clusters
        }
        return [x, y];
    }
}
