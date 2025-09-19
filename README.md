# Civicomfy - Civitai Model Downloader for ComfyUI

Civicomfy seamlessly integrates Civitai's vast model repository directly into ComfyUI, allowing you to search, download, and organize AI models without leaving your workflow.

## Features

- **Integrated Model Search**: Search Civitai's extensive library directly from ComfyUI
- **One-Click Downloads**: Download models with associated metadata and thumbnails
- **Automatic Organization**: Models are automatically saved to their appropriate directories
- **Clean UI**: Clean, intuitive interface that complements ComfyUI's aesthetic

## Installation

Git clone
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/MoonGoblinDev/Civicomfy.git
```

Comfy-CLI
```bash
comfy node registry-install civicomfy
```

ComfyUI Manager

<img width="813" alt="Screenshot 2025-04-08 at 11 42 46" src="https://github.com/user-attachments/assets/5d4f5261-88f6-4aa0-9c66-d1811bb49e09" />

## Usage

1. Start ComfyUI with Civicomfy installed
2. Access the Civicomfy panel from the Civicomfy menu button at the right top area.
3. Search for models
4. Click the download button on any model to save it to your local installation
5. Models become immediately available in ComfyUI nodes

### Library-First Workflows (New)

This extension adds a lightweight, add-only workflow system and card-scoped bindings:

- Add to ComfyUI: Inserts one node pre-initialized with the model from a Library card. Card-specific binding is preferred when present; otherwise settings-based mapping is used.
- Workflow menu: Each Library card has a Workflow button with
  - Add a saved workflow: choose a saved workflow, preview affected nodes and model bindings, and append it to the current canvas.
  - Save current workspace as workflow: saves currently selected nodes and their connections as a named workflow and attaches it to the card.

Workflows and attachments are persisted under the extension folder as JSON.

Storage files:
- `workflows.json`: { version, workflows: [ { workflow_id, name, node_list, connections, metadata } ] }
- `card_meta.json`: { version, cards: { <download_id>: { workflow_ids:[], single_node_binding:{ node_type, widget } } } }

Minimal REST API:
- `GET /civitai/workflows?card_id=<optional>` → { workflows:[{ workflow_id, name, node_count, connection_count, metadata }] }
- `GET /civitai/workflows/{workflow_id}` → { workflow }
- `POST /civitai/workflows` body { workflow_id?, name, node_list, connections, metadata? } → { success, workflow_id }
- `DELETE /civitai/workflows/{workflow_id}` → { success }
- `GET /civitai/cards/{card_id}/workflows` → { card_id, workflow_ids, single_node_binding, workflows:[summary] }
- `POST /civitai/cards/{card_id}/attach_workflow` body { workflow_id } → { success, card }
- `POST /civitai/cards/{card_id}/detach_workflow` body { workflow_id } → { success, card }
- `POST /civitai/cards/{card_id}/set_binding` body { node_type, widget? } → { success, card }
- `GET /civitai/workflows/export` → full workflows JSON
- `POST /civitai/workflows/import` body { workflows:[...] } → { success, count }

Frontend behavior:
- Saving captures type, widgets, positions, and connections between selected nodes.
- Applying creates fresh node instances and re-links them; existing nodes are untouched. Optional external links are honored if defined in `workflow.metadata.external_links`.
- Model references in widgets are resolved by filename against the Library with a preview and replacement selectors for missing models.

Notes:
- Running the same workflow multiple times creates distinct node instances each time.
- This update does not remove or modify existing settings/features.

## Configuration

- Enter your Civitai API Token in the setting

## Screenshots
<img width="911" alt="Screenshot 2025-04-08 at 11 24 40" src="https://github.com/user-attachments/assets/b9be0c32-729d-490e-be61-2dc072cd9b15" />
<img width="911" alt="Screenshot 2025-04-08 at 11 23 17" src="https://github.com/user-attachments/assets/cb747c22-afd0-4baf-a9a2-39c70fb11e46" />
<img width="911" alt="Screenshot 2025-04-08 at 11 25 15" src="https://github.com/user-attachments/assets/02b6d841-a0fa-484c-91a4-4095a7554c3f" />
<img width="911" alt="Screenshot 2025-04-08 at 11 25 24" src="https://github.com/user-attachments/assets/20fcfcb5-3345-4a72-89fe-ee9c50626ebc" />




## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
