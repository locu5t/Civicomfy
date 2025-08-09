# ================================================
# File: server/routes/DownloaderSettings.py
# ================================================
import json
import os
from aiohttp import web
import server # ComfyUI server instance
from ..utils import get_request_json
from ...config import PLUGIN_ROOT

prompt_server = server.PromptServer.instance

# Settings file path
DOWNLOADER_SETTINGS_FILE = os.path.join(PLUGIN_ROOT, "downloader_settings.json")

def get_default_downloader_settings():
    """Get default downloader settings."""
    return {
        "downloader_type": "aria2",  # "aria2" or "legacy"
        "aria2_max_connections": 16,
        "aria2_concurrent_downloads": 3,
    }

def load_downloader_settings():
    """Load downloader settings from file."""
    defaults = get_default_downloader_settings()
    
    if os.path.exists(DOWNLOADER_SETTINGS_FILE):
        try:
            with open(DOWNLOADER_SETTINGS_FILE, 'r', encoding='utf-8') as f:
                loaded_settings = json.load(f)
                return {**defaults, **loaded_settings}
        except Exception as e:
            print(f"[DownloaderSettings] Error loading settings: {e}")
            return defaults
    
    return defaults

def save_downloader_settings(settings):
    """Save downloader settings to file."""
    try:
        os.makedirs(os.path.dirname(DOWNLOADER_SETTINGS_FILE), exist_ok=True)
        with open(DOWNLOADER_SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(settings, f, indent=2)
        return True
    except Exception as e:
        print(f"[DownloaderSettings] Error saving settings: {e}")
        return False

def get_current_downloader_type():
    """Get the currently selected downloader type."""
    settings = load_downloader_settings()
    return settings.get("downloader_type", "aria2")

def is_aria2_available():
    """Check if aria2 is available for use."""
    try:
        from ...utils.aria2_binary import get_aria2_binary_manager
        manager = get_aria2_binary_manager(PLUGIN_ROOT)
        available, path = manager.is_aria2_available()
        return available, path
    except Exception as e:
        print(f"[DownloaderSettings] Error checking aria2: {e}")
        return False, None

@prompt_server.routes.get("/civitai/downloader-settings")
async def route_get_downloader_settings(request):
    """Get current downloader settings."""
    try:
        settings = load_downloader_settings()
        
        # Add aria2 availability info
        aria2_available, aria2_path = is_aria2_available()
        settings["aria2_available"] = aria2_available
        settings["aria2_path"] = aria2_path
        
        # Add version info if available
        if aria2_available:
            try:
                from ...utils.aria2_binary import get_aria2_binary_manager
                manager = get_aria2_binary_manager(PLUGIN_ROOT)
                version = manager.get_version(aria2_path)
                settings["aria2_version"] = version
            except:
                settings["aria2_version"] = "Unknown"
        
        return web.json_response(settings)
        
    except Exception as e:
        print(f"[DownloaderSettings] Error getting settings: {e}")
        return web.json_response({
            "error": "Failed to get settings",
            "details": str(e)
        }, status=500)

@prompt_server.routes.post("/civitai/downloader-settings")
async def route_set_downloader_settings(request):
    """Update downloader settings."""
    try:
        data = await get_request_json(request)
        
        # Validate downloader_type
        downloader_type = data.get("downloader_type", "aria2")
        if downloader_type not in ["aria2", "legacy"]:
            return web.json_response({
                "error": "Invalid downloader type",
                "details": "Must be 'aria2' or 'legacy'"
            }, status=400)
        
        # If selecting aria2, check if it's available
        if downloader_type == "aria2":
            aria2_available, _ = is_aria2_available()
            if not aria2_available:
                return web.json_response({
                    "error": "Aria2 not available",
                    "details": "Aria2 binary not found. Please install aria2 or use legacy downloader."
                }, status=400)
        
        # Load current settings and update
        current_settings = load_downloader_settings()
        
        # Update with new values
        if "downloader_type" in data:
            current_settings["downloader_type"] = data["downloader_type"]
        if "aria2_max_connections" in data:
            connections = int(data["aria2_max_connections"])
            if 1 <= connections <= 32:
                current_settings["aria2_max_connections"] = connections
            else:
                return web.json_response({
                    "error": "Invalid connections",
                    "details": "Must be between 1 and 32"
                }, status=400)
        if "aria2_concurrent_downloads" in data:
            concurrent = int(data["aria2_concurrent_downloads"])
            if 1 <= concurrent <= 10:
                current_settings["aria2_concurrent_downloads"] = concurrent
            else:
                return web.json_response({
                    "error": "Invalid concurrent downloads",
                    "details": "Must be between 1 and 10"
                }, status=400)
        
        # Save settings
        if save_downloader_settings(current_settings):
            # Clear the downloader cache so changes take effect immediately
            try:
                from ...utils.downloader_factory import clear_downloader_cache
                clear_downloader_cache()
            except Exception as cache_error:
                print(f"[DownloaderSettings] Warning: Could not clear downloader cache: {cache_error}")
            
            return web.json_response({
                "success": True,
                "message": "Settings saved successfully",
                "settings": current_settings
            })
        else:
            return web.json_response({
                "error": "Failed to save settings",
                "details": "Could not write to settings file"
            }, status=500)
            
    except Exception as e:
        print(f"[DownloaderSettings] Error setting settings: {e}")
        return web.json_response({
            "error": "Failed to update settings",
            "details": str(e)
        }, status=500)

@prompt_server.routes.post("/civitai/downloader-settings/test-aria2")
async def route_test_aria2(request):
    """Test aria2 availability and daemon startup."""
    try:
        # Check binary availability
        aria2_available, aria2_path = is_aria2_available()
        if not aria2_available:
            return web.json_response({
                "success": False,
                "error": "Aria2 binary not found",
                "details": "Please install aria2 using your system package manager"
            })
        
        # Try to start daemon briefly to test
        try:
            from ...downloader.aria2_daemon import Aria2Daemon
            daemon = Aria2Daemon(rpc_port=6802)  # Use different port for test
            
            if daemon.start():
                # Get version info
                try:
                    from ...utils.aria2_binary import get_aria2_binary_manager
                    manager = get_aria2_binary_manager(PLUGIN_ROOT)
                    version = manager.get_version(aria2_path)
                except:
                    version = "Unknown"
                
                # Shutdown test daemon
                daemon.shutdown()
                
                return web.json_response({
                    "success": True,
                    "message": "Aria2 is working correctly",
                    "aria2_path": aria2_path,
                    "aria2_version": version
                })
            else:
                return web.json_response({
                    "success": False,
                    "error": "Failed to start aria2 daemon",
                    "details": "Aria2 binary found but daemon failed to start"
                })
                
        except Exception as daemon_error:
            return web.json_response({
                "success": False,
                "error": "Daemon test failed",
                "details": str(daemon_error)
            })
        
    except Exception as e:
        print(f"[DownloaderSettings] Error testing aria2: {e}")
        return web.json_response({
            "success": False,
            "error": "Test failed",
            "details": str(e)
        })