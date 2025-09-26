# UI Layout Documentation

## Civicomfy Launcher
- Section: ComfyUI Button Group – contains the "Civicomfy" button labeled with tooltip "Open Civicomfy" before the modal is instantiated.【F:web/js/civitaiDownloader.js†L15-L37】
- Section: ComfyUI Menu Fallback – if the button group is unavailable, the launcher button is inserted before the "Settings" button inside the `.comfy-menu` container.【F:web/js/civitaiDownloader.js†L56-L67】

**Flow:**
1. ComfyUI loads and the extension injects the "Civicomfy" launcher into the main toolbar.【F:web/js/civitaiDownloader.js†L15-L33】
2. Selecting **"Civicomfy"** creates the Civicomfy modal (if not already present) and attaches it to the document body.【F:web/js/civitaiDownloader.js†L33-L38】
3. After initialization, the same button reopens the existing modal whenever it is clicked.【F:web/js/civitaiDownloader.js†L48-L50】

## Civicomfy Modal Window
- Template: `civitai-downloader-modal-content` – fixed-height dialog with header, tab strip, tab panes, and toast region.【F:web/js/ui/templates.js†L6-L136】
- Section: Header – title "Civicomfy" and close button labeled "×".【F:web/js/ui/templates.js†L7-L10】
- Section: Tab Strip – buttons "Library", "Search", and "Settings" with download indicator span inside the Search tab label.【F:web/js/ui/templates.js†L12-L17】
- Section: Library Tab Container `#civitai-tab-library` – hosts library controls and list panel.【F:web/js/ui/templates.js†L19-L29】
- Section: Search Tab Container `#civitai-tab-search` – includes the search form, results container, and pagination area.【F:web/js/ui/templates.js†L31-L59】
- Section: Settings Tab Container `#civitai-tab-settings` – wraps the settings form and submit button.【F:web/js/ui/templates.js†L61-L130】
- Section: Toast Region `#civitai-toast` – global notification strip anchored beneath the modal body.【F:web/js/ui/templates.js†L134-L135】

**Flow:**
1. The modal opens focused on the **Library** tab after the launcher button is activated.【F:web/js/ui/templates.js†L12-L30】【F:web/js/civitaiDownloader.js†L33-L50】
2. Selecting a tab button toggles the corresponding tab pane and deactivates the others.【F:web/js/ui/UI.js†L210-L229】
3. Closing the modal via the header button hides the entire dialog until the launcher is clicked again.【F:web/js/ui/UI.js†L255-L281】

### Library Tab
- Section: Library Controls – filter input "Filter downloaded models...", count label, and "Refresh" button with sync icon inside `.civitai-library-control-actions`.【F:web/js/ui/templates.js†L20-L25】
- Section: Library List – scrollable list container `#civitai-library-list` populated with library items and empty-state message.【F:web/js/ui/templates.js†L27-L28】【F:web/js/ui/libraryRenderer.js†L61-L149】

**Flow:**
1. When the modal loads, the library tab displays the filter controls above the list placeholder.【F:web/js/ui/templates.js†L20-L29】
2. The list renderer injects individual card elements into `#civitai-library-list` once library data is available.【F:web/js/ui/libraryRenderer.js†L71-L149】
3. Using the "Refresh" button re-renders the list after fetching updated items.【F:web/js/ui/handlers/eventListeners.js†L54-L118】

#### Library Item Layout
- Panel: Thumbnail Container – `.civitai-thumbnail-container` with optional NSFW overlay badge and fallback image handling.【F:web/js/ui/libraryRenderer.js†L91-L119】
- Panel: Details Column – title, metadata badges, storage path, and optional published/downloaded timestamps.【F:web/js/ui/libraryRenderer.js†L120-L133】
- Panel: Tag Rows – trigger and tag pill groups rendered within `.civitai-library-tags` blocks.【F:web/js/ui/libraryRenderer.js†L105-L133】
- Panel: Action Bar – buttons in order: view details (magnifier icon), open containing folder, add to ComfyUI, workflow, edit tags & triggers, and delete (trash icon).【F:web/js/ui/libraryRenderer.js†L134-L140】

**Flow:**
1. Clicking **View details** launches the Model Details overlay for the selected item.【F:web/js/ui/handlers/eventListeners.js†L54-L74】
2. Clicking **Workflow** opens the Workflow popup tied to the same card.【F:web/js/ui/handlers/eventListeners.js†L88-L101】【F:web/js/ui/UI.js†L1906-L1933】
3. Clicking **Edit tags & triggers** opens the Card Metadata Drawer beside the modal.【F:web/js/ui/handlers/eventListeners.js†L102-L115】【F:web/js/ui/UI.js†L960-L1180】

### Search Tab
- Section: Search Controls – query text field, provider selector, type selector, base model selector, sort selector, and "Search" submit button.【F:web/js/ui/templates.js†L33-L57】
- Section: Results Grid – container `#civitai-search-results` for card renderings, followed by pagination slot `#civitai-search-pagination`.【F:web/js/ui/templates.js†L58-L59】

**Flow:**
1. Submitting the search form renders result cards inside the results container and updates pagination metadata.【F:web/js/ui/handlers/eventListeners.js†L120-L137】【F:web/js/ui/handlers/searchHandler.js†L611-L618】
2. Selecting a card’s **Download** button reveals the inline download drawer for that model.【F:web/js/ui/handlers/searchHandler.js†L643-L662】
3. Choosing **Queue download** adds the job and keeps the drawer visible while status updates populate the footer.【F:web/js/ui/handlers/searchHandler.js†L689-L696】【F:web/js/ui/UI.js†L600-L648】

#### Search Result Card
- Section: Card Top – thumbnail container `.civi-thumb`, title, author label, and stats row within `.civi-meta`.【F:web/js/ui/searchRenderer.js†L53-L60】
- Section: Actions Row – version selector, "Download" button, "Select" checkbox label, and "View details" icon button.【F:web/js/ui/searchRenderer.js†L63-L68】
- Section: Local Metadata Row – path display and trigger placeholder inside `.civi-local-meta`.【F:web/js/ui/searchRenderer.js†L70-L73】
- Section: Download Drawer – nested layout with preview summary, files list, folder fields, path preview, filename override, option toggles, and action buttons "Queue download" and "Close".【F:web/js/ui/searchRenderer.js†L75-L113】
- Section: Status Footer – progress bar, status text, error display, and dynamic action buttons rendered when jobs are active.【F:web/js/ui/searchRenderer.js†L116-L123】【F:web/js/ui/UI.js†L630-L696】

**Flow:**
1. Using **View details** on a search card summons the Model Details overlay while keeping the card in place.【F:web/js/ui/handlers/searchHandler.js†L643-L656】【F:web/js/ui/detailsModal.js†L35-L220】
2. Pressing **Close** inside the drawer collapses the drawer and returns focus to the card layout.【F:web/js/ui/handlers/searchHandler.js†L659-L662】
3. When a download updates, the status footer shows progress text and provides **Cancel**, **Retry**, or **Open** buttons as appropriate.【F:web/js/ui/UI.js†L600-L748】

### Settings Tab
- Section: API & Defaults – API key, token, connection count, and default type inputs grouped under a titled panel.【F:web/js/ui/templates.js†L64-L84】
- Section: Interface & Search – checkboxes and NSFW threshold numeric input with helper text.【F:web/js/ui/templates.js†L86-L103】
- Section: ComfyUI Node Mapping – "Refresh Nodes" button, search fields, and mapping grids for type and base model rows.【F:web/js/ui/templates.js†L105-L127】
- Footer: Primary "Save Settings" button positioned below the grid.【F:web/js/ui/templates.js†L129-L130】

**Flow:**
1. Switching to the **Settings** tab displays the form populated with stored preferences.【F:web/js/ui/UI.js†L210-L229】【F:web/js/ui/templates.js†L61-L130】
2. Pressing **Save Settings** commits the form state and keeps the tab active.【F:web/js/ui/handlers/settingsHandler.js†L88-L127】
3. Using "Refresh Nodes" regenerates the mapping grids before the drawer previews are updated.【F:web/js/ui/templates.js†L108-L126】【F:web/js/ui/UI.js†L1687-L1776】

### Toast Notification
- Element: `#civitai-toast` – floating message strip controlled by the Feedback class for info, success, error, and warning states.【F:web/js/ui/templates.js†L134-L135】【F:web/js/ui/feedback.js†L4-L33】

## Card Metadata Drawer
- Container: `.civitai-card-meta-container` with backdrop and drawer role="dialog"; header shows "Edit tags & triggers" with close button.【F:web/js/ui/UI.js†L960-L983】
- Section: Triggers Editor – chip editor block labeled "Triggers" with add-all and inline helper text.【F:web/js/ui/UI.js†L987-L999】
- Section: Tags Editor – mirrored chip editor block labeled "Tags".【F:web/js/ui/UI.js†L1001-L1013】
- Section: Prompt Clipboard – toolbar with "Separator", "Apply to", buttons "Copy", "Paste", "Clear", "Apply", plus footer buttons "Add item" and "Save as prompt group".【F:web/js/ui/UI.js†L1015-L1035】【F:web/js/ui/promptClipboard.js†L29-L55】
- Section: Prompt Groups – list wrapper with header and action buttons "Apply", "Rename", and "Delete" per group.【F:web/js/ui/UI.js†L1037-L1155】
- Section: Preview – displays selected custom triggers and tags using pill styling.【F:web/js/ui/UI.js†L1048-L1074】
- Footer: Drawer-level buttons "Cancel" and "Save" (primary).【F:web/js/ui/UI.js†L1159-L1172】

**Flow:**
1. Selecting **Edit tags & triggers** on a library card opens the drawer alongside the modal and focuses the triggers editor.【F:web/js/ui/handlers/eventListeners.js†L102-L115】【F:web/js/ui/UI.js†L960-L1180】
2. Using clipboard controls can push items into the selected chip editor, updating the preview group immediately.【F:web/js/ui/UI.js†L1015-L1074】
3. Choosing **Save** applies the drawer state to the card, while **Cancel** or the close button dismisses the drawer without changes.【F:web/js/ui/UI.js†L1159-L1185】【F:web/js/ui/UI.js†L1181-L1239】

## Prompt Clipboard Component
- Header: Title "Clipboard" with live item count indicator.【F:web/js/ui/promptClipboard.js†L29-L34】
- Toolbar: Separator selector, target selector, and buttons "Copy", "Paste", "Clear", "Apply" grouped together.【F:web/js/ui/promptClipboard.js†L35-L49】
- List: Ordered `<ul>` container for prompt rows, each row including drag handle, text input, and delete button (implicit in renderList).【F:web/js/ui/promptClipboard.js†L51-L140】
- Footer: Buttons "Add item" and "Save as prompt group".【F:web/js/ui/promptClipboard.js†L52-L55】

**Flow:**
1. Clipboard buttons enable copying, pasting, clearing, or applying the listed entries to the active editor target.【F:web/js/ui/promptClipboard.js†L35-L105】
2. "Add item" appends an empty row and focuses its input; removing or reordering items updates the count immediately.【F:web/js/ui/promptClipboard.js†L107-L140】
3. "Save as prompt group" becomes available when at least one item exists and stores the list for reuse via the prompt groups panel.【F:web/js/ui/promptClipboard.js†L52-L105】【F:web/js/ui/UI.js†L1037-L1155】

## Chip Editor Component
- Header: Title label with "Add all" button on the right.【F:web/js/ui/chipEditor.js†L44-L50】
- Input Row: Text field with placeholder guidance and "Add" button "+" aligned beside it.【F:web/js/ui/chipEditor.js†L52-L59】
- Chips List: List container for existing chips, each showing a label and "×" remove button.【F:web/js/ui/chipEditor.js†L61-L107】
- Helper Text: Instructional paragraph displayed below the chip list.【F:web/js/ui/chipEditor.js†L60-L63】

**Flow:**
1. Entering text and pressing **Add** or the Enter key converts the value into a chip within the list.【F:web/js/ui/chipEditor.js†L90-L138】
2. Selecting **Add all** injects every source suggestion that is not already present.【F:web/js/ui/chipEditor.js†L33-L50】【F:web/js/ui/chipEditor.js†L118-L129】
3. Clicking the chip remove button deletes that entry and returns focus to the input field.【F:web/js/ui/chipEditor.js†L83-L106】

## Model Details Overlay
- Container: `.civi-details-overlay` full-screen backdrop containing `.civi-details-modal` dialog.【F:web/js/ui/detailsModal.js†L35-L48】
- Header: Model title, optional creator label, external link button, and close button with "×" icon.【F:web/js/ui/detailsModal.js†L50-L64】
- Body Layout: Two-column flex body with gallery/description column and metadata column.【F:web/js/ui/detailsModal.js†L66-L170】
- Gallery: Scrollable media strip with image/video thumbnails and fullscreen affordance.【F:web/js/ui/detailsModal.js†L75-L140】
- Descriptions: "Model Description" and "Version Notes" panels stacked under the gallery.【F:web/js/ui/detailsModal.js†L142-L150】
- Metadata Column: Type/base/version badges, statistic icons, tag chips, and trained word chips.【F:web/js/ui/detailsModal.js†L152-L218】

**Flow:**
1. Triggers such as **View details** from library or search surfaces open the overlay centered over the app.【F:web/js/ui/handlers/eventListeners.js†L54-L74】【F:web/js/ui/handlers/searchHandler.js†L643-L656】
2. Clicking a gallery image or video opens the fullscreen viewer layer with caption text.【F:web/js/ui/detailsModal.js†L75-L113】
3. The close button or backdrop click removes the overlay and returns control to the originating surface.【F:web/js/ui/detailsModal.js†L50-L64】【F:web/js/ui/detailsModal.js†L75-L113】

## Workflow Popup
- Container: `#civitai-workflow-popup` using `.civitai-confirmation-modal` styling with dialog wrapper and footer actions.【F:web/js/ui/UI.js†L1906-L1933】
- Button Row: Primary "Add a saved workflow" and secondary "Save current workspace as workflow" inside the modal body.【F:web/js/ui/UI.js†L1914-L1919】
- Content Area: Dynamic region `#civi-wf-area` used for apply or save sub-views (forms, lists, previews).【F:web/js/ui/UI.js†L1920-L2037】
- Footer: "Close" button within `.civitai-confirmation-modal-actions`.【F:web/js/ui/UI.js†L1921-L1932】

**Flow:**
1. Choosing **Workflow** on a library card opens this popup above the modal.【F:web/js/ui/handlers/eventListeners.js†L88-L101】【F:web/js/ui/UI.js†L1906-L1933】
2. Selecting **Add a saved workflow** replaces the content area with a searchable workflow list and preview controls.【F:web/js/ui/UI.js†L1917-L2038】
3. Selecting **Save current workspace as workflow** swaps in the save form with name input and "Save & Attach to Card" button.【F:web/js/ui/UI.js†L1918-L1968】

## Library Search Node Overlay
- Container: `.civi-lib-node-overlay` anchored to a ComfyUI graph node with `.civi-lib-node-root` interior frame.【F:web/js/ui/nodes/librarySearchNode.js†L39-L53】
- Header: Title "Library", tab buttons "Models" and "Images", connector chip row, and buttons "Refresh" and "Undo".【F:web/js/ui/nodes/librarySearchNode.js†L45-L47】
- Body Split: Left column with search input and results list; right column hosting embedded card preview or image grid.【F:web/js/ui/nodes/librarySearchNode.js†L47-L53】【F:web/js/ui/nodes/librarySearchNode.js†L63-L81】
- Embedded Card Host: Reuses Civicomfy search card layout inside the node overlay for mapping workflows and files.【F:web/js/ui/nodes/librarySearchNode.js†L68-L79】
- Images Grid: Masonry-style gallery with per-image action buttons "Load Workflow", "Resources", and "Use Prompt".【F:web/js/ui/nodes/librarySearchNode.js†L79-L83】

**Flow:**
1. Opening the node overlay defaults to the active tab saved in node state and runs a library search to populate the left column.【F:web/js/ui/nodes/librarySearchNode.js†L39-L63】
2. Selecting a result injects a Civicomfy card into the right column with its download drawer expanded for connector mapping.【F:web/js/ui/nodes/librarySearchNode.js†L63-L70】
3. Switching to the **Images** tab displays the offline image grid where each tile offers workflow and prompt actions.【F:web/js/ui/nodes/librarySearchNode.js†L63-L83】

## Confirmation Modal Template
- Styling Hook: `.civitai-confirmation-modal` flex container with centered `.civitai-confirmation-modal-content`.【F:web/js/civitaiDownloader.css†L629-L677】
- Buttons: Footer actions typically include neutral and danger variants such as "Cancel" and "Replace & Disconnect" in port-change prompts.【F:web/js/ui/nodes/librarySearchNode.js†L86-L90】

**Flow:**
1. When schema changes require confirmation (e.g., adjusting node outputs), the confirmation modal overlays the workspace.【F:web/js/ui/nodes/librarySearchNode.js†L86-L90】
2. Choosing the danger button applies the pending change and closes the modal, while "Cancel" dismisses without changes.【F:web/js/ui/nodes/librarySearchNode.js†L86-L90】
3. The same modal style is reused by the workflow popup container for consistent dialog presentation.【F:web/js/ui/UI.js†L1906-L1933】【F:web/js/civitaiDownloader.css†L629-L677】
