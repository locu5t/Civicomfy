# ================================================
# File: utils/downloader_factory.py
# Downloader Factory - Dynamic Selection Based on Settings
# ================================================

import os
from typing import Any, Optional

# Global state for caching and logging
_cached_manager: Optional[Any] = None
_cached_settings_hash: Optional[str] = None
_logged_decision: bool = False

def get_active_download_manager() -> Any:
    """
    Get the currently active download manager based on user settings.
    Returns either Aria2DownloadManager or legacy manager instance.
    Caches the result and only logs the decision once per session.
    """
    global _cached_manager, _cached_settings_hash, _logged_decision
    
    try:
        # Import settings function
        from ..server.routes.DownloaderSettings import get_current_downloader_type, is_aria2_available
        
        # Get current settings
        preferred_type = get_current_downloader_type()
        aria2_available, aria2_path = is_aria2_available()
        
        # Create a hash of current settings to detect changes
        settings_hash = f"{preferred_type}:{aria2_available}:{aria2_path}"
        
        # Return cached manager if settings haven't changed
        if _cached_manager and _cached_settings_hash == settings_hash:
            return _cached_manager
        
        # Settings changed or first run, need to determine manager
        manager = None
        decision_logged = False
        
        # If user prefers aria2 and it's available, use it
        if preferred_type == "aria2":
            if aria2_available:
                try:
                    from ..downloader.aria2_manager import get_aria2_manager
                    manager = get_aria2_manager()
                    if not _logged_decision or _cached_settings_hash != settings_hash:
                        print(f"[DownloaderFactory] Using Aria2 download manager")
                        decision_logged = True
                except Exception as e:
                    if not _logged_decision or _cached_settings_hash != settings_hash:
                        print(f"[DownloaderFactory] Failed to initialize Aria2 manager: {e}")
                        print(f"[DownloaderFactory] Falling back to legacy manager")
                        decision_logged = True
            else:
                if not _logged_decision or _cached_settings_hash != settings_hash:
                    print(f"[DownloaderFactory] Aria2 not available, using legacy manager")
                    decision_logged = True
        
        # Fall back to legacy manager if not set
        if not manager:
            from ..downloader.manager import manager as legacy_manager
            manager = legacy_manager
            if not decision_logged and (not _logged_decision or _cached_settings_hash != settings_hash):
                print(f"[DownloaderFactory] Using legacy download manager")
        
        # Cache the result
        _cached_manager = manager
        _cached_settings_hash = settings_hash
        _logged_decision = True
        
        return manager
        
    except Exception as e:
        # Only log errors once per session unless settings changed
        if not _logged_decision or _cached_settings_hash != "error":
            print(f"[DownloaderFactory] Error in downloader selection: {e}")
            print(f"[DownloaderFactory] Falling back to legacy manager")
            _logged_decision = True
            _cached_settings_hash = "error"
        
        # Final fallback to legacy manager
        try:
            from ..downloader.manager import manager as legacy_manager
            _cached_manager = legacy_manager
            return legacy_manager
        except Exception as fallback_error:
            print(f"[DownloaderFactory] Critical error: Could not load any downloader: {fallback_error}")
            raise RuntimeError("No download manager available")

def clear_downloader_cache():
    """Clear the cached downloader to force re-selection on next request."""
    global _cached_manager, _cached_settings_hash, _logged_decision
    _cached_manager = None
    _cached_settings_hash = None
    _logged_decision = False

def get_downloader_info() -> dict:
    """Get information about the active downloader."""
    try:
        from ..server.routes.DownloaderSettings import get_current_downloader_type, is_aria2_available
        
        preferred_type = get_current_downloader_type()
        aria2_available, aria2_path = is_aria2_available()
        
        # Determine actual active type
        if preferred_type == "aria2" and aria2_available:
            active_type = "aria2"
        else:
            active_type = "legacy"
        
        return {
            "preferred_type": preferred_type,
            "active_type": active_type,
            "aria2_available": aria2_available,
            "aria2_path": aria2_path,
            "fallback_reason": None if active_type == preferred_type else "aria2_unavailable"
        }
        
    except Exception as e:
        return {
            "preferred_type": "unknown",
            "active_type": "legacy",
            "aria2_available": False,
            "aria2_path": None,
            "fallback_reason": f"error: {e}"
        }