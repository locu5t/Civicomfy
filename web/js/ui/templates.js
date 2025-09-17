// Modal template for Civicomfy UI
// Keep structure identical to the original inline HTML to minimize risk

export function modalTemplate(settings = {}) {
  return `
    <div class="civitai-downloader-modal-content">
      <div class="civitai-downloader-header">
        <h2>Civicomfy</h2>
        <button class="civitai-close-button" id="civitai-close-modal">&times;</button>
      </div>
      <div class="civitai-downloader-body">
        <div class="civitai-downloader-tabs">
          <button class="civitai-downloader-tab active" data-tab="library">Library</button>
          <button class="civitai-downloader-tab" data-tab="search">
            Search<span id="civitai-download-indicator" class="civitai-download-indicator" aria-live="polite"></span>
          </button>
          <button class="civitai-downloader-tab" data-tab="settings">Settings</button>
        </div>
        <div id="civitai-tab-library" class="civitai-downloader-tab-content active">
          <div class="civitai-library-controls">
            <input type="text" id="civitai-library-search" class="civitai-input" placeholder="Filter downloaded models...">
            <div class="civitai-library-control-actions">
              <span id="civitai-library-count" class="civitai-library-count">0 models</span>
              <button type="button" id="civitai-library-refresh" class="civitai-button small"><i class="fas fa-sync-alt"></i> Refresh</button>
            </div>
          </div>
          <div id="civitai-library-list" class="civitai-library-list">
            <p class="civitai-library-empty">No downloaded models yet. Queue downloads from the Search tab.</p>
          </div>
        </div>
        <div id="civitai-tab-search" class="civitai-downloader-tab-content">
          <form id="civitai-search-form">
            <div class="civitai-search-controls">
              <input type="text" id="civitai-search-query" class="civitai-input" placeholder="Search Civitai or paste a Model URL/ID...">
              <select id="civitai-search-type" class="civitai-select">
                <option value="any">Any Type</option>
              </select>
              <select id="civitai-search-base-model" class="civitai-select">
                <option value="any">Any Base Model</option>
              </select>
              <select id="civitai-search-sort" class="civitai-select">
                <option value="Relevancy">Relevancy</option>
                <option value="Highest Rated">Highest Rated</option>
                <option value="Most Liked">Most Liked</option>
                <option value="Most Discussed">Most Discussed</option>
                <option value="Most Collected">Most Collected</option>
                <option value="Most Buzz">Most Buzz</option>
                <option value="Most Downloaded">Most Downloaded</option>
                <option value="Newest">Newest</option>
              </select>
            </div>
            <button type="submit" id="civitai-search-submit" class="civitai-button primary">Search</button>
          </form>
          <div id="civitai-search-results" class="civitai-search-results"></div>
          <div id="civitai-search-pagination" style="text-align: center; margin-top: 20px;"></div>
        </div>
        <div id="civitai-tab-settings" class="civitai-downloader-tab-content">
          <form id="civitai-settings-form">
            <div class="civitai-settings-container">
              <div class="civitai-settings-section">
                <h4>API & Defaults</h4>
                <div class="civitai-form-group">
                  <label for="civitai-settings-api-key">Civitai API Key (Optional)</label>
                  <input type="password" id="civitai-settings-api-key" class="civitai-input" placeholder="Enter API key for higher limits / authenticated access" autocomplete="new-password">
                  <p style="font-size: 0.85em; color: #bbb; margin-top: 5px;">Needed for some downloads/features. Find keys at civitai.com/user/account</p>
                </div>
                <div class="civitai-form-group">
                  <label for="civitai-settings-connections">Default Connections</label>
                  <input type="number" id="civitai-settings-connections" class="civitai-input" value="1" min="1" max="16" step="1" required disabled>
                  <p style="font-size: 0.85em; color: #bbb; margin-top: 5px;">Disabled. Only single connection possible for now</p>
                </div>
                <div class="civitai-form-group">
                  <label for="civitai-settings-default-type">Default Model Type (for saving)</label>
                  <select id="civitai-settings-default-type" class="civitai-select" required></select>
                </div>
              </div>
              <div class="civitai-settings-section">
                <h4>Interface & Search</h4>
                <div class="civitai-form-group inline">
                  <input type="checkbox" id="civitai-settings-hide-mature" class="civitai-checkbox" ${settings.hideMatureInSearch ? 'checked' : ''}>
                  <label for="civitai-settings-hide-mature">Hide R-rated (Mature) images in search (click to reveal)</label>
                </div>
                <div class="civitai-form-group inline">
                  <input type="checkbox" id="civitai-settings-merged-ui" class="civitai-checkbox" ${settings.mergedSearchDownloadUI ? 'checked' : ''}>
                  <label for="civitai-settings-merged-ui">Use merged Search & Download layout (beta)</label>
                </div>
                <div class="civitai-form-group">
                  <label for="civitai-settings-nsfw-threshold">NSFW Blur Threshold (nsfwLevel)</label>
                  <input type="number" id="civitai-settings-nsfw-threshold" class="civitai-input" value="${Number.isFinite(settings.nsfwBlurMinLevel) ? settings.nsfwBlurMinLevel : 4}" min="0" max="128" step="1">
                  <p style="font-size: 0.85em; color: #bbb; margin-top: 5px;">
                    Blur thumbnails when an image's <code>nsfwLevel</code> is greater than or equal to this value.
                    Higher numbers indicate more explicit content. None (Safe/PG): 1, Mild (PG-13): 2, Mature (R): 4, Adult (X): 5, Extra Explicit (R): 8, Explicit (XXX): 16/32+
                  </p>
                </div>
              </div>
            </div>
            <button type="submit" id="civitai-settings-save" class="civitai-button primary" style="margin-top: 20px;">Save Settings</button>
          </form>
        </div>
      </div>
      <!-- Toast Notification Area -->
      <div id="civitai-toast" class="civitai-toast"></div>
    </div>
  `;
}
