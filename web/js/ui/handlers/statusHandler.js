import { CivitaiDownloaderAPI } from "../../api/civitai.js";

export function startStatusUpdates(ui) {
    if (!ui.statusInterval) {
        console.log("[Civicomfy] Starting status updates (every 3s)...");
        ui.updateStatus();
        ui.statusInterval = setInterval(() => ui.updateStatus(), 3000);
    }
}

export function stopStatusUpdates(ui) {
    if (ui.statusInterval) {
        clearInterval(ui.statusInterval);
        ui.statusInterval = null;
        console.log("[Civicomfy] Stopped status updates.");
    }
}

export async function updateStatus(ui) {
    if (!ui.modal || !ui.modal.classList.contains('open')) return;

    try {
        const newStatusData = await CivitaiDownloaderAPI.getStatus();
        if (!newStatusData || !Array.isArray(newStatusData.active) || !Array.isArray(newStatusData.queue) || !Array.isArray(newStatusData.history)) {
            throw new Error("Invalid status data structure received from server.");
        }

        ui.statusData = newStatusData;

        const activeCount =
            (Array.isArray(ui.statusData.active) ? ui.statusData.active.length : 0) +
            (Array.isArray(ui.statusData.queue) ? ui.statusData.queue.length : 0);

        if (ui.downloadIndicator) {
            if (activeCount > 0) {
                ui.downloadIndicator.textContent = ` (${activeCount})`;
                ui.downloadIndicator.style.display = '';
                ui.downloadIndicator.setAttribute('aria-label', `${activeCount} active downloads`);
            } else {
                ui.downloadIndicator.textContent = '';
                ui.downloadIndicator.style.display = '';
                ui.downloadIndicator.removeAttribute('aria-label');
            }
        }

        if (typeof ui.updateCardStatuses === 'function') {
            ui.updateCardStatuses(newStatusData);
        }

        if (ui.activeTab === 'library') {
            ui.loadLibraryItems(false);
        }
    } catch (error) {
        console.error("[Civicomfy] Failed to update status:", error);
        if (ui.downloadIndicator) {
            ui.downloadIndicator.textContent = ' (!)';
            ui.downloadIndicator.style.display = '';
            ui.downloadIndicator.setAttribute('aria-label', 'Download status unavailable');
        }
    }
}

export async function handleCancelDownload(ui, downloadId, button) {
    const targetButton = button || ui.modal.querySelector(`.civitai-cancel-button[data-id="${downloadId}"]`);
    const originalContent = targetButton?.innerHTML;
    if (targetButton) {
        targetButton.disabled = true;
        targetButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        targetButton.title = "Cancelling...";
    }
    try {
        const result = await CivitaiDownloaderAPI.cancelDownload(downloadId);
        ui.showToast(result.message || `Cancellation requested for ${downloadId}`, 'info');
        ui.updateStatus();
    } catch (error) {
        const message = `Cancel failed: ${error.details || error.message}`;
        console.error("Cancel Download Error:", error);
        ui.showToast(message, 'error');
    } finally {
        if (targetButton) {
            targetButton.disabled = false;
            targetButton.innerHTML = originalContent || '<i class="fas fa-times"></i>';
            targetButton.title = "Cancel Download";
        }
    }
}

export async function handleRetryDownload(ui, downloadId, button) {
    const originalContent = button.innerHTML;
    const originalTitle = button.title;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    button.title = "Retrying...";
    try {
        const result = await CivitaiDownloaderAPI.retryDownload(downloadId);
        if (result.success) {
            ui.showToast(result.message || `Retry queued successfully!`, 'success');
            ui.updateStatus();
        } else {
            ui.showToast(`Retry failed: ${result.details || result.error}`, 'error', 5000);
        }
    } catch (error) {
        const message = `Retry failed: ${error.details || error.message}`;
        console.error("Retry Download UI Error:", error);
        ui.showToast(message, 'error', 5000);
    } finally {
        button.disabled = false;
        button.innerHTML = originalContent || '<i class="fas fa-redo"></i>';
        button.title = originalTitle || "Retry Download";
    }
}

export async function handleOpenPath(ui, downloadId, button) {
    const originalIcon = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    button.title = "Opening...";
    try {
        const result = await CivitaiDownloaderAPI.openPath(downloadId);
        if (result.success) {
            ui.showToast(result.message || `Opened path successfully!`, 'success');
        } else {
            ui.showToast(`Open path failed: ${result.details || result.error}`, 'error', 5000);
        }
    } catch (error) {
        const message = `Open path failed: ${error.details || error.message}`;
        console.error("Open Path UI Error:", error);
        ui.showToast(message, 'error', 5000);
    } finally {
        button.disabled = false;
        button.innerHTML = originalIcon;
        button.title = "Open Containing Folder";
    }
}

