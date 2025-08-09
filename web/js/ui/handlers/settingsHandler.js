import { setCookie, getCookie } from "../../utils/cookies.js";

const SETTINGS_COOKIE_NAME = 'civitaiDownloaderSettings';

export function getDefaultSettings() {
    return {
        apiKey: '',
        numConnections: 1,
        defaultModelType: 'checkpoint',
        autoOpenStatusTab: true,
        searchResultLimit: 20,
        downloaderType: 'aria2', // 'aria2' or 'legacy'
    };
}

export function loadAndApplySettings(ui) {
    ui.settings = ui.loadSettingsFromCookie();
    ui.applySettings();
}

export function loadSettingsFromCookie(ui) {
    const defaults = ui.getDefaultSettings();
    const cookieValue = getCookie(SETTINGS_COOKIE_NAME);

    if (cookieValue) {
        try {
            const loadedSettings = JSON.parse(cookieValue);
            return { ...defaults, ...loadedSettings };
        } catch (e) {
            console.error("Failed to parse settings cookie:", e);
            return defaults;
        }
    }
    return defaults;
}

export function saveSettingsToCookie(ui) {
    try {
        const settingsString = JSON.stringify(ui.settings);
        setCookie(SETTINGS_COOKIE_NAME, settingsString, 365);
        ui.showToast('Settings saved successfully!', 'success');
    } catch (e) {
        console.error("Failed to save settings to cookie:", e);
        ui.showToast('Error saving settings', 'error');
    }
}

export function applySettings(ui) {
    if (ui.settingsApiKeyInput) {
        ui.settingsApiKeyInput.value = ui.settings.apiKey || '';
    }
    if (ui.settingsConnectionsInput) {
        ui.settingsConnectionsInput.value = Math.max(1, Math.min(16, ui.settings.numConnections || 1));
    }
    if (ui.settingsDefaultTypeSelect) {
        ui.settingsDefaultTypeSelect.value = ui.settings.defaultModelType || 'checkpoint';
    }
    if (ui.settingsAutoOpenCheckbox) {
        ui.settingsAutoOpenCheckbox.checked = ui.settings.autoOpenStatusTab === true;
    }
    if (ui.downloadConnectionsInput) {
        ui.downloadConnectionsInput.value = Math.max(1, Math.min(16, ui.settings.numConnections || 1));
    }
    if (ui.downloadModelTypeSelect && Object.keys(ui.modelTypes).length > 0) {
        ui.downloadModelTypeSelect.value = ui.settings.defaultModelType || 'checkpoint';
    }
    ui.searchPagination.limit = ui.settings.searchResultLimit || 20;
    
    // Apply downloader settings
    applyDownloaderSettings(ui);
}

export function handleSettingsSave(ui) {
    const apiKey = ui.settingsApiKeyInput.value.trim();
    const numConnections = parseInt(ui.settingsConnectionsInput.value, 10);
    const defaultModelType = ui.settingsDefaultTypeSelect.value;
    const autoOpenStatusTab = ui.settingsAutoOpenCheckbox.checked;

    if (isNaN(numConnections) || numConnections < 1 || numConnections > 16) {
        ui.showToast("Invalid Default Connections (must be 1-16).", "error");
        return;
    }
    if (!ui.settingsDefaultTypeSelect.querySelector(`option[value="${defaultModelType}"]`)) {
        ui.showToast("Invalid Default Model Type selected.", "error");
        return;
    }

    ui.settings.apiKey = apiKey;
    ui.settings.numConnections = numConnections;
    ui.settings.defaultModelType = defaultModelType;
    ui.settings.autoOpenStatusTab = autoOpenStatusTab;
    ui.settings.downloaderType = ui.settingsDownloaderTypeSelect?.value || 'aria2';

    // Save settings to both cookie and backend
    ui.saveSettingsToCookie();
    saveDownloaderSettingsToBackend(ui);
    ui.applySettings();
}

export async function loadDownloaderSettings(ui) {
    try {
        const response = await fetch('/civitai/downloader-settings');
        if (response.ok) {
            const settings = await response.json();
            ui.downloaderSettings = settings;
            
            // Update UI settings with backend values
            if (ui.settings) {
                ui.settings.downloaderType = settings.downloader_type;
                ui.settings.aria2MaxConnections = settings.aria2_max_connections;
                ui.settings.aria2ConcurrentDownloads = settings.aria2_concurrent_downloads;
            }
            
            return settings;
        } else {
            console.warn('Failed to load downloader settings from backend');
            return null;
        }
    } catch (error) {
        console.error('Error loading downloader settings:', error);
        return null;
    }
}

export async function saveDownloaderSettingsToBackend(ui) {
    const downloaderType = ui.settingsDownloaderTypeSelect?.value || 'aria2';
    const aria2MaxConnections = parseInt(ui.settingsAria2ConnectionsInput?.value || '16', 10);
    const aria2ConcurrentDownloads = parseInt(ui.settingsAria2ConcurrentInput?.value || '3', 10);

    try {
        const response = await fetch('/civitai/downloader-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                downloader_type: downloaderType,
                aria2_max_connections: aria2MaxConnections,
                aria2_concurrent_downloads: aria2ConcurrentDownloads,
            })
        });

        if (response.ok) {
            const result = await response.json();
            ui.showToast('Downloader settings saved successfully!', 'success');
        } else {
            const error = await response.json();
            ui.showToast(`Failed to save downloader settings: ${error.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving downloader settings:', error);
        ui.showToast('Error saving downloader settings', 'error');
    }
}

export function applyDownloaderSettings(ui) {
    // Apply downloader type selection
    if (ui.settingsDownloaderTypeSelect) {
        ui.settingsDownloaderTypeSelect.value = ui.settings.downloaderType || 'aria2';
        toggleAria2Settings(ui);
    }
    
    // Apply aria2 specific settings
    if (ui.settingsAria2ConnectionsInput) {
        ui.settingsAria2ConnectionsInput.value = ui.settings.aria2MaxConnections || 16;
    }
    if (ui.settingsAria2ConcurrentInput) {
        ui.settingsAria2ConcurrentInput.value = ui.settings.aria2ConcurrentDownloads || 3;
    }
    
    // Update downloader status
    updateDownloaderStatus(ui);
}

export function toggleAria2Settings(ui) {
    const aria2SettingsDiv = document.getElementById('civitai-aria2-settings');
    const downloaderType = ui.settingsDownloaderTypeSelect?.value || 'aria2';
    
    if (aria2SettingsDiv) {
        aria2SettingsDiv.style.display = downloaderType === 'aria2' ? 'block' : 'none';
    }
}

export async function updateDownloaderStatus(ui) {
    const statusElement = document.getElementById('civitai-downloader-status');
    if (!statusElement) return;
    
    const downloaderType = ui.settingsDownloaderTypeSelect?.value || 'aria2';
    
    if (downloaderType === 'aria2') {
        // Check aria2 status
        try {
            const settings = await loadDownloaderSettings(ui);
            if (settings && settings.aria2_available) {
                statusElement.innerHTML = `<span style="color: #4CAF50;">✓ Aria2 available (${settings.aria2_version || 'Unknown version'})</span>`;
            } else {
                statusElement.innerHTML = `<span style="color: #f44336;">✗ Aria2 not available. Install with: brew install aria2</span>`;
            }
        } catch (error) {
            statusElement.innerHTML = `<span style="color: #ff9800;">⚠ Could not check Aria2 status</span>`;
        }
    } else {
        statusElement.innerHTML = `<span style="color: #2196F3;">ℹ Using built-in downloader</span>`;
    }
}

export async function testAria2(ui) {
    const testButton = document.getElementById('civitai-test-aria2');
    if (!testButton) return;
    
    const originalText = testButton.textContent;
    testButton.textContent = 'Testing...';
    testButton.disabled = true;
    
    try {
        const response = await fetch('/civitai/downloader-settings/test-aria2', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            ui.showToast(`Aria2 test successful! ${result.message}`, 'success');
        } else {
            ui.showToast(`Aria2 test failed: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Aria2 test error:', error);
        ui.showToast('Failed to test Aria2 connection', 'error');
    } finally {
        testButton.textContent = originalText;
        testButton.disabled = false;
    }
}