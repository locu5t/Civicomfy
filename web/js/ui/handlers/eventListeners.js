export function setupEventListeners(ui) {
    // Modal close
    ui.closeButton.addEventListener('click', () => ui.closeModal());
    ui.modal.addEventListener('click', (event) => {
        if (event.target === ui.modal) ui.closeModal();
    });

    // Tab switching
    ui.tabContainer.addEventListener('click', (event) => {
        if (event.target.matches('.civitai-downloader-tab')) {
            ui.switchTab(event.target.dataset.tab);
        }
    });

    // --- Library interactions ---
    if (ui.librarySearchInput) {
        ui.librarySearchInput.addEventListener('input', () => {
            if (ui.librarySearchTimeout) clearTimeout(ui.librarySearchTimeout);
            ui.librarySearchTimeout = setTimeout(() => ui.applyLibraryFilter(), 180);
        });
    }

    if (ui.libraryRefreshButton) {
        ui.libraryRefreshButton.addEventListener('click', () => ui.loadLibraryItems(true));
    }

    if (ui.libraryListContainer) {
        ui.libraryListContainer.addEventListener('click', async (event) => {
            const pill = event.target.closest('.civitai-library-pill');
            if (pill) {
                const text = pill.textContent || '';
                if (text) {
                    try {
                        await navigator.clipboard.writeText(text);
                        ui.showToast(`${text} copied`, 'success');
                    } catch (err) {
                        ui.showToast('Failed to copy trigger', 'error');
                    }
                }
                return;
            }

            const button = event.target.closest('button');
            if (!button) return;
            const downloadId = button.dataset.id;
            if (button.classList.contains('civitai-library-open')) {
                ui.handleOpenPath(downloadId, button);
            } else if (button.classList.contains('civitai-library-delete')) {
                await ui.handleDeleteLibraryItem(downloadId, button);
            }
        });
    }

    ui.searchForm.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!ui.searchQueryInput.value.trim() && ui.searchTypeSelect.value === 'any' && ui.searchBaseModelSelect.value === 'any') {
            ui.showToast("Please enter a search query or select a filter.", "error");
            if (ui.searchResultsContainer) ui.searchResultsContainer.innerHTML = '<p>Please enter a search query or select a filter.</p>';
            if (ui.searchPaginationContainer) ui.searchPaginationContainer.innerHTML = '';
            return;
        }
        ui.searchPagination.currentPage = 1;
        ui.handleSearchSubmit();
    });

    ui.settingsForm.addEventListener('submit', (event) => {
        event.preventDefault();
        ui.handleSettingsSave();
    });

    // --- DYNAMIC CONTENT LISTENERS (Event Delegation) ---

    // Search results actions, including click-to-toggle blur and inline download controls
    ui.searchResultsContainer.addEventListener('click', (event) => {
        const statusButton = event.target.closest('.civi-status-action');
        if (statusButton) {
            const downloadId = statusButton.dataset.id;
            if (downloadId) {
                if (statusButton.classList.contains('civi-status-action-cancel')) {
                    ui.handleCancelDownload(downloadId, statusButton);
                } else if (statusButton.classList.contains('civi-status-action-retry')) {
                    ui.handleRetryDownload(downloadId, statusButton);
                } else if (statusButton.classList.contains('civi-status-action-open')) {
                    ui.handleOpenPath(downloadId, statusButton);
                }
            }
            event.preventDefault();
            return;
        }

        if (ui.settings?.mergedSearchDownloadUI) {
            return;
        }
        const thumbContainer = event.target.closest('.civitai-thumbnail-container');
        if (thumbContainer) {
            const nsfwLevel = Number(thumbContainer.dataset.nsfwLevel ?? thumbContainer.getAttribute('data-nsfw-level'));
            const threshold = Number(ui.settings?.nsfwBlurMinLevel ?? 4);
            const enabled = ui.settings?.hideMatureInSearch === true;
            if (enabled && Number.isFinite(nsfwLevel) && nsfwLevel >= threshold) {
                if (thumbContainer.classList.contains('blurred')) {
                    thumbContainer.classList.remove('blurred');
                    const overlay = thumbContainer.querySelector('.civitai-nsfw-overlay');
                    if (overlay) overlay.remove();
                } else {
                    thumbContainer.classList.add('blurred');
                    if (!thumbContainer.querySelector('.civitai-nsfw-overlay')) {
                        const ov = document.createElement('div');
                        ov.className = 'civitai-nsfw-overlay';
                        ov.title = 'R-rated: click to reveal';
                        ov.textContent = 'R';
                        thumbContainer.appendChild(ov);
                    }
                }
                return; // Don't trigger other actions on this click
            }
        }

        const viewAllButton = event.target.closest('.show-all-versions-button');
        if (viewAllButton) {
            const modelId = viewAllButton.dataset.modelId;
            const versionsContainer = ui.searchResultsContainer.querySelector(`#all-versions-${modelId}`);
            if (versionsContainer) {
                const currentlyVisible = versionsContainer.style.display !== 'none';
                versionsContainer.style.display = currentlyVisible ? 'none' : 'flex';
                viewAllButton.innerHTML = currentlyVisible
                    ? `All versions (${viewAllButton.dataset.totalVersions}) <i class="fas fa-chevron-down"></i>`
                    : `Show less <i class="fas fa-chevron-up"></i>`;
            }
        }
    });

    // Pagination
    ui.searchPaginationContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.civitai-page-button');
        if (button && !button.disabled) {
            const page = parseInt(button.dataset.page, 10);
            if (page && page !== ui.searchPagination.currentPage) {
                ui.searchPagination.currentPage = page;
                ui.handleSearchSubmit();
            }
        }
    });
}
