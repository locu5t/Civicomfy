# Civicomfy Installation Guide

## Quick Install

### Option 1: ComfyUI Manager (Recommended)
1. Open ComfyUI Manager
2. Search for "Civicomfy" 
3. Click Install
4. Restart ComfyUI

### Option 2: Git Clone
```bash
cd ComfyUI/custom_nodes/
git clone https://github.com/MoonGoblinDev/Civicomfy.git
cd Civicomfy
pip install -r requirements.txt
# Restart ComfyUI
```

## Dependencies

### Python Dependencies
The extension requires these Python packages:
- `aria2p>=0.12.0` - Aria2 download engine integration
- `requests>=2.28.0` - HTTP client for API calls
- `aiohttp>=3.8.0` - Async web framework

Install with:
```bash
pip install -r requirements.txt
```

### Aria2 Binary (Optional but Recommended)
For enhanced download performance, install the aria2 binary:

**macOS:**
```bash
brew install aria2
```

**Ubuntu/Debian:**
```bash
sudo apt update && sudo apt install aria2
```

**Windows:**
1. Download from [aria2 releases](https://github.com/aria2/aria2/releases)
2. Extract to a folder in your PATH
3. Or let Civicomfy auto-download (not supported on Windows yet)

**Note:** If aria2 is not available, Civicomfy will automatically fall back to the built-in downloader.

## Verification

After installation, verify everything works:

1. **Start ComfyUI** - Look for "Civicomfy loaded" in the console
2. **Open Civicomfy** - Click the Civicomfy button in the toolbar
3. **Check Settings** - Go to Settings tab and verify:
   - Downloader type shows "Aria2 (Recommended)" with green checkmark
   - Or "Legacy (Built-in)" if aria2 is not available
4. **Test Download** - Try downloading a small model

## Troubleshooting

### "Aria2 not available" 
- Install aria2 binary (see above)
- Or switch to "Legacy" downloader in Settings

### Import Errors
```bash
# Install full dependencies
pip install -r requirements.txt

# Or install minimal dependencies
pip install aria2p requests aiohttp
```

### Permission Issues
```bash
# Use --user flag if you don't have admin access
pip install --user -r requirements.txt
```

### ComfyUI Not Finding Extension
1. Ensure installed in `ComfyUI/custom_nodes/Civicomfy/`
2. Check console for error messages
3. Restart ComfyUI completely
4. Check that `__init__.py` exists in the plugin directory

### Download Issues
1. Check internet connection
2. Verify Civitai API is accessible
3. Try switching downloader type in Settings
4. Check ComfyUI console for error messages

## Configuration

### Settings Location
- UI Settings: Stored in browser cookies
- Downloader Settings: `ComfyUI/custom_nodes/Civicomfy/downloader_settings.json`
- Download History: `ComfyUI/custom_nodes/Civicomfy/download_history.json`

### Default Directories
Models are saved to ComfyUI's standard directories:
- Checkpoints: `ComfyUI/models/checkpoints/`
- LoRAs: `ComfyUI/models/loras/`
- VAE: `ComfyUI/models/vae/`
- etc.

## Update

### Via ComfyUI Manager
1. Open ComfyUI Manager
2. Go to Update tab
3. Find Civicomfy and click Update

### Via Git
```bash
cd ComfyUI/custom_nodes/Civicomfy/
git pull
pip install -r requirements.txt --upgrade
# Restart ComfyUI
```

## Support

If you encounter issues:
1. Check the console for error messages
2. Verify all dependencies are installed
3. Try the legacy downloader if aria2 has issues
4. Report issues on [GitHub](https://github.com/MoonGoblinDev/Civicomfy/issues)