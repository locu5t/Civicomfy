# Civicomfy Developer Guide

## Overview
Civicomfy embeds a full model search-and-download workflow from Civitai directly inside ComfyUI. The Python entrypoint wires the downloader, HTTP routes, and static web assets into ComfyUI while validating that required frontend files exist and that default model directories are ready to use.【F:__init__.py†L7-L104】 The extension exposes REST endpoints, a background download queue with metadata capture, and a modal UI that users open from a custom toolbar button.

## Repository Structure
| Path | Purpose |
| --- | --- |
| `__init__.py` | ComfyUI integration point that loads configuration, instantiates the download manager, registers routes, and exposes the web directory.【F:__init__.py†L17-L104】 |
| `config.py` | Central configuration for concurrency limits, timeout values, model directory mappings, and static asset paths.【F:config.py†L7-L94】 |
| `api/` | Lightweight wrapper around Civitai's REST and Meilisearch APIs used by the backend.【F:api/civitai.py†L1-L284】 |
| `server/` | aiohttp route handlers plus helper utilities that service the UI's REST calls.【F:server/routes/DownloadModel.py†L19-L400】【F:server/utils.py†L12-L154】 |
| `downloader/` | Download manager thread, chunked downloader implementation, and shutdown hooks that execute work in the background.【F:downloader/manager.py†L34-L929】【F:downloader/chunk_downloader.py†L1-L520】 |
| `utils/` | Helper functions for resolving save directories, parsing Civitai URLs, and sanitising filenames.【F:utils/helpers.py†L1-L204】 |
| `web/` | Frontend bundle (JS, CSS, images) served to the browser by ComfyUI to render the Civicomfy modal UI.【F:web/js/civitaiDownloader.js†L1-L88】【F:web/js/civitaiDownloader.css†L1-L640】 |

## Backend Architecture
### Configuration and Directory Resolution
`config.py` defines throttling constants (such as `MAX_CONCURRENT_DOWNLOADS`), timeouts, file suffixes, and model-type directory mappings that the rest of the system consumes. It also records the plugin root and placeholder asset locations for startup logging.【F:config.py†L7-L94】 Helpers like `get_model_dir` and `sanitize_filename` ensure files land in valid folders with safe names, using ComfyUI's registered directories when possible.【F:utils/helpers.py†L45-L204】

### Civitai API Access
`api/civitai.py` wraps standard and Meilisearch endpoints, offering resilient JSON parsing and error surfaces for the rest of the backend. It includes a `_MeiliQuery` dataclass to build multi-filter searches, provides direct methods for model/version lookups, and maps UI sort values into Meilisearch sort clauses.【F:api/civitai.py†L15-L284】 These routines are reused across routes (search, details preview, and download preparation).

### Model/Version Resolution Helper
`get_civitai_model_and_version_details` consolidates the logic for parsing user input, resolving model versus version IDs, fetching core metadata, and picking an appropriate primary file. It gracefully handles version-only inputs, fallback download URLs, and raises HTTP errors when the API returns unusable data.【F:server/utils.py†L12-L154】 The download and preview routes depend on this helper so their behaviour stays consistent.

### Download Request Pipeline
The `/civitai/download` route accepts a mixed payload of identifiers, target directories, and optional file overrides. It normalises inputs, fetches the latest model/version data when required, honours explicit file IDs or name filters, and computes the target output path (including subdirectories and user-specified filenames). Existing files trigger `exists` responses unless the caller forces a redownload.【F:server/routes/DownloadModel.py†L19-L352】 Once validation succeeds, the route queues a rich `download_info` record—including metadata for later `.cminfo.json` and preview generation—and returns the queue ID to the UI.【F:server/routes/DownloadModel.py†L353-L403】

### Download Manager and Background Threads
`DownloadManager` owns the queue, active download map, and bounded worker thread that dequeues tasks. It generates unique IDs, persists history to `download_history.json`, strips sensitive fields before reporting status, and exposes cancellation, retry, and history-clearing operations.【F:downloader/manager.py†L34-L520】 Metadata and preview images are written after successful downloads via `_save_civitai_metadata` and `_download_and_save_preview`, preserving Civitai stats and thumbnails next to the model file.【F:downloader/manager.py†L456-L636】 The manager also supports retries that clone previous parameters (forcing re-download) and opening the containing folder with OS-specific commands, while validating that the path is inside known safe directories.【F:downloader/manager.py†L684-L874】 A shutdown hook cancels in-flight jobs and waits briefly for worker threads when ComfyUI exits.【F:downloader/manager.py†L882-L929】

### Chunked Downloader
`ChunkDownloader` attempts multi-connection downloads when the remote server supports HTTP range requests and the file size exceeds a configured threshold; otherwise it falls back to a single streaming request. Progress callbacks keep the manager's status data fresh, temporary part files are merged when multi-download succeeds, and clean-up removes partial artifacts on failure. The class also records connection type (multi vs single) for UI display and surfaces detailed errors when network or HTTP issues occur.【F:downloader/chunk_downloader.py†L1-L520】 Notably, the file documents that multi-connection support remains a known limitation.【F:downloader/chunk_downloader.py†L1-L4】

### REST Endpoints
Alongside the download route, the extension exposes a suite of REST handlers:
- `/civitai/get_model_details` renders preview metadata using the helper above for the download form.【F:server/routes/GetModelDetails.py†L15-L167】
- `/civitai/search` proxies Meilisearch queries, mapping UI filters to API parameters and enriching hits with thumbnail URLs before returning pagination info.【F:server/routes/SearchModels.py†L14-L141】
- `/civitai/status`, `/civitai/cancel`, `/civitai/retry`, `/civitai/open_path`, and `/civitai/clear_history` surface queue state and management actions to the UI.【F:server/routes/GetStatus.py†L1-L18】【F:server/routes/CancelDownload.py†L12-L41】【F:server/routes/RetryDownload.py†L11-L36】【F:server/routes/OpenPath.py†L11-L49】【F:server/routes/ClearHistory.py†L11-L36】
- `/civitai/model_types`, `/civitai/model_dirs`, `/civitai/create_dir`, `/civitai/create_model_type`, `/civitai/model_roots`, and `/civitai/create_root` help the UI browse and manage save locations.【F:server/routes/GetModelTypes.py†L11-L26】【F:server/routes/GetModelDirs.py†L1-L176】
- `/civitai/base_models` returns the baked list of Meili base model filters from configuration.【F:server/routes/GetBaseModels.py†L1-L18】

## Frontend Architecture
### Bootstrap and Asset Loading
`web/js/civitaiDownloader.js` registers the extension with ComfyUI, injects the Civicomfy button into the toolbar (falling back to the main menu if necessary), and lazily instantiates the UI modal on first use. It also attaches the stylesheet via `addCssLink` and warns if the placeholder image is missing.【F:web/js/civitaiDownloader.js†L12-L88】【F:web/js/utils/dom.js†L3-L32】 The shared `Feedback` helper loads Font Awesome once and manages toast notifications across the UI.【F:web/js/ui/feedback.js†L3-L39】

### Modal Layout and Tabs
`CivitaiDownloaderUI` constructs the modal markup from `modalTemplate`, caches DOM references, and wires up event handlers for form submissions, tab switching, blur toggles, and inline status controls. It immediately creates the modal element, attaches a `Feedback` instance, and maintains UI state such as selected model types, pagination, and settings.【F:web/js/ui/UI.js†L13-L848】 The template defines three tabs—Library, Search, and Settings—plus the toast container; download activity is surfaced directly on the Search tab instead of a dedicated Status view.【F:web/js/ui/templates.js†L4-L154】【F:web/js/civitaiDownloader.css†L74-L965】

### Download Tab Behaviour
The download form debounces preview requests, fetches metadata for the entered URL/ID, auto-selects a save folder based on the model type, and lets users override file variants when multiple assets exist. Subdirectory creation and model-type folder creation invoke backend endpoints directly from the event listeners. Submissions queue downloads through the API client and immediately trigger a status refresh so the associated search card reflects progress in place.【F:web/js/ui/handlers/eventListeners.js†L16-L146】【F:web/js/ui/handlers/downloadHandler.js†L3-L110】【F:web/js/ui/previewRenderer.js†L5-L96】

### Search Tab
Search requests combine text queries with type and base-model filters, then render rich result cards that include stats, tags, version download buttons, and NSFW-aware thumbnails. Users can pre-fill the download form by clicking a version button, while pagination controls maintain state inside the UI class.【F:web/js/ui/handlers/searchHandler.js†L1-L35】【F:web/js/ui/searchRenderer.js†L6-L188】【F:web/js/ui/UI.js†L118-L208】 NSFW thumbnails respect the blur threshold and can be toggled per image via delegated click handlers.【F:web/js/ui/handlers/eventListeners.js†L89-L178】

### Inline download status
Status updates poll the backend every three seconds while the modal is open, merging queue, active, and history data. The poller updates the Search tab indicator and applies status data to any cards with known download IDs, including progress bars, speed readouts, errors, and cancel/retry/open-folder actions. History entries keep the badges in sync, and the library tab reloads when active so completed downloads appear automatically.【F:web/js/ui/handlers/statusHandler.js†L1-L84】【F:web/js/ui/UI.js†L214-L600】【F:web/js/ui/handlers/searchHandler.js†L488-L666】

### Settings and Persistence
User preferences—such as default model type, NSFW blur level, and stored API key—are cached in a cookie and reapplied on load. Both the settings form and download tab inputs honour these defaults so the UX stays consistent between sessions.【F:web/js/ui/handlers/settingsHandler.js†L3-L94】【F:web/js/utils/cookies.js†L4-L20】 The modal also disables multi-connection controls in the UI, mirroring the backend's current single-connection behaviour.【F:web/js/ui/templates.js†L48-L67】

### REST Client Layer
`web/js/api/civitai.js` wraps ComfyUI's `fetchApi`, providing consistent error objects and helpers for every backend route the UI touches (download, preview, search, status, directory management, history actions). All handlers import this class so request/response handling stays uniform.【F:web/js/api/civitai.js†L1-L144】

## Data and History Files
Download history persists to `download_history.json` within the extension directory. The manager prunes entries to the configured limit, reloads them on startup, and rewrites the file atomically to avoid corruption. Clearing history removes both the in-memory list and the on-disk file.【F:downloader/manager.py†L30-L220】【F:downloader/manager.py†L266-L370】 Custom root paths registered via `/civitai/create_root` are saved to `custom_roots.json` for reuse across sessions.【F:server/routes/GetModelDirs.py†L12-L108】

## Development Tips
1. **Backend reloads** – When hacking on Python modules, restart ComfyUI so `__init__.py` re-imports the manager and route modules. Watch the console output for the startup banner confirming that frontend assets were detected and directories validated.【F:__init__.py†L77-L104】
2. **Frontend builds** – The JavaScript bundle is served as-is from the `web` folder; no build step is required. Use the browser dev tools to hot-reload scripts and CSS while adjusting UI code, and ensure Font Awesome loads so icon buttons render correctly.【F:web/js/civitaiDownloader.js†L12-L88】【F:web/js/ui/feedback.js†L9-L39】
3. **API inspection** – Trace REST calls via the browser network panel. Each endpoint in `web/js/api/civitai.js` maps one-to-one with a backend route, making it straightforward to correlate client and server behaviour.【F:web/js/api/civitai.js†L44-L144】
4. **Multi-download testing** – The chunk downloader currently falls back to single-connection mode unless range requests succeed; the top-of-file comment highlights that multi-connection support still needs attention. Keep this in mind when debugging throughput issues.【F:downloader/chunk_downloader.py†L1-L4】【F:downloader/chunk_downloader.py†L400-L520】
5. **History data** – Inspect `download_history.json` to verify stored metadata or to pre-populate retry scenarios. The manager's retry logic copies historical entries, forces re-download, and removes the old history record once enqueued.【F:downloader/manager.py†L684-L748】 The open-path helper enforces directory safety, so make sure tests run with paths under registered ComfyUI locations.【F:downloader/manager.py†L755-L874】

