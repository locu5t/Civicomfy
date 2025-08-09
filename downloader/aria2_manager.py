# ================================================
# File: downloader/aria2_manager.py
# Aria2-based Download Manager
# ================================================

import json
import os
import time
import datetime
import threading
from typing import List, Dict, Any, Optional, Callable
from pathlib import Path

try:
    import aria2p
    ARIA2P_AVAILABLE = True
except ImportError:
    ARIA2P_AVAILABLE = False
    print("[Aria2Manager] Warning: aria2p not available. Install with: pip install aria2p")

from ..config import (
    ARIA2_RPC_PORT, ARIA2_MAX_CONCURRENT_DOWNLOADS, ARIA2_MAX_CONNECTION_PER_SERVER,
    ARIA2_MIN_SPLIT_SIZE, ARIA2_RPC_SECRET, DOWNLOAD_HISTORY_LIMIT, PLUGIN_ROOT,
    METADATA_SUFFIX, PREVIEW_SUFFIX, METADATA_DOWNLOAD_TIMEOUT
)
from .aria2_daemon import get_aria2_daemon
import requests

# History file path
HISTORY_FILE_PATH = os.path.join(PLUGIN_ROOT, "download_history.json")

class Aria2DownloadManager:
    """Download manager using Aria2 as the backend."""
    
    def __init__(self):
        """Initialize the Aria2 download manager."""
        if not ARIA2P_AVAILABLE:
            raise RuntimeError("aria2p package is required but not installed")
            
        self.lock = threading.Lock()
        self.history: List[Dict[str, Any]] = []
        self.running = True
        
        # Aria2 client and daemon
        self.daemon = get_aria2_daemon(
            rpc_port=ARIA2_RPC_PORT,
            rpc_secret=ARIA2_RPC_SECRET,
            max_concurrent_downloads=ARIA2_MAX_CONCURRENT_DOWNLOADS,
            max_connection_per_server=ARIA2_MAX_CONNECTION_PER_SERVER,
            min_split_size=ARIA2_MIN_SPLIT_SIZE
        )
        self.client: Optional[aria2p.API] = None
        
        # Load history and start daemon
        self._load_history_from_file()
        self._ensure_daemon_running()
        
        # Start monitoring thread
        self.monitor_thread = threading.Thread(target=self._monitor_downloads, daemon=True)
        self.monitor_thread.start()
        
        print(f"[Aria2Manager] Initialized with daemon on port {self.daemon.rpc_port}")
    
    def _ensure_daemon_running(self) -> bool:
        """Ensure aria2 daemon is running and client is connected."""
        if not self.daemon.is_healthy():
            print("[Aria2Manager] Starting aria2 daemon...")
            if not self.daemon.start():
                print("[Aria2Manager] Failed to start aria2 daemon")
                return False
        
        if not self.client:
            try:
                conn_info = self.daemon.get_connection_info()
                self.client = aria2p.API(
                    aria2p.Client(
                        host=f'http://{conn_info["host"]}',
                        port=conn_info["port"],
                        secret=conn_info["secret"]
                    )
                )
                # Test connection
                version = self.client.client.get_version()
                print(f"[Aria2Manager] Connected to aria2 {version['version']}")
                return True
                
            except Exception as e:
                print(f"[Aria2Manager] Failed to connect to daemon: {e}")
                self.client = None
                return False
        
        return True
    
    def add_to_queue(self, download_info: Dict[str, Any]) -> str:
        """Add a download task to aria2 queue."""
        if not self._ensure_daemon_running():
            raise RuntimeError("Aria2 daemon not available")
        
        with self.lock:
            # Generate unique ID
            timestamp = int(time.time() * 1000)
            file_hint = os.path.basename(download_info.get('output_path', 'file'))[:10]
            download_id = f"aria2_{timestamp}_{file_hint}"
            
            # Prepare download info
            download_info["id"] = download_id
            download_info["status"] = "queued"
            download_info["added_time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            download_info["progress"] = 0
            download_info["speed"] = 0
            download_info["error"] = None
            download_info["start_time"] = None
            download_info["end_time"] = None
            download_info["connection_type"] = "Aria2"
            
            try:
                # Prepare aria2 download options
                options = self._prepare_aria2_options(download_info)
                
                # Add download to aria2
                uri = download_info["url"]
                download = self.client.add_uris([uri], options=options)
                
                # Store aria2 gid for tracking
                download_info["aria2_gid"] = download.gid
                
                print(f"[Aria2Manager] Queued: {download_info.get('filename', 'N/A')} (ID: {download_id}, GID: {download.gid})")
                return download_id
                
            except Exception as e:
                download_info["status"] = "failed"
                download_info["error"] = f"Failed to queue download: {e}"
                download_info["end_time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                self._add_to_history(download_info)
                raise RuntimeError(f"Failed to queue download: {e}")
    
    def _prepare_aria2_options(self, download_info: Dict[str, Any]) -> Dict[str, str]:
        """Prepare aria2 download options from download_info."""
        output_path = download_info["output_path"]
        output_dir = os.path.dirname(output_path)
        filename = os.path.basename(output_path)
        
        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)
        
        options = {
            "dir": output_dir,
            "out": filename,
            "max-connection-per-server": str(ARIA2_MAX_CONNECTION_PER_SERVER),
            "split": str(min(ARIA2_MAX_CONNECTION_PER_SERVER, 16)),  # Max segments
            "continue": "true",
            "auto-file-renaming": "false",
            "allow-overwrite": "true" if download_info.get("force_redownload", False) else "false",
        }
        
        # Add authentication headers if needed
        if download_info.get("api_key"):
            options["header"] = f"Authorization: Bearer {download_info['api_key']}"
        
        # Add user agent
        options["user-agent"] = "Civicomfy/1.0 (aria2)"
        
        return options
    
    def cancel_download(self, download_id: str) -> bool:
        """Cancel a download by ID."""
        if not self._ensure_daemon_running():
            return False
            
        try:
            # Find download info with aria2 GID
            download_info = self._find_download_by_id(download_id)
            if not download_info:
                print(f"[Aria2Manager] Download ID not found: {download_id}")
                return False
            
            aria2_gid = download_info.get("aria2_gid")
            if not aria2_gid:
                print(f"[Aria2Manager] No aria2 GID found for download: {download_id}")
                return False
            
            # Cancel in aria2
            try:
                download = self.client.get_download(aria2_gid)
                if download:
                    if download.status in ["active", "waiting", "paused"]:
                        success = self.client.remove([download])
                        if success:
                            print(f"[Aria2Manager] Cancelled download: {download_id}")
                            return True
                    else:
                        print(f"[Aria2Manager] Download {download_id} already in terminal state: {download.status}")
                        return True
            except Exception as e:
                print(f"[Aria2Manager] Error cancelling download {download_id}: {e}")
                
            return False
            
        except Exception as e:
            print(f"[Aria2Manager] Error in cancel_download: {e}")
            return False
    
    def _find_download_by_id(self, download_id: str) -> Optional[Dict[str, Any]]:
        """Find download info by ID in active downloads or history."""
        # Check active downloads from aria2
        if self.client:
            try:
                all_downloads = self.client.get_downloads()
                for download in all_downloads:
                    # Check if this download matches our ID (stored in options or metadata)
                    # For now, we'll search through our tracking
                    pass
            except:
                pass
        
        # Check history
        for item in self.history:
            if item.get("id") == download_id:
                return item
        
        return None
    
    def get_status(self) -> Dict[str, List[Dict[str, Any]]]:
        """Get current download status."""
        if not self._ensure_daemon_running():
            return {"queue": [], "active": [], "history": self.history[:DOWNLOAD_HISTORY_LIMIT]}
        
        with self.lock:
            try:
                all_downloads = self.client.get_downloads()
                
                queue = []
                active = []
                
                for download in all_downloads:
                    download_dict = self._aria2_download_to_dict(download)
                    
                    if download.status == "waiting":
                        queue.append(download_dict)
                    elif download.status in ["active", "paused"]:
                        active.append(download_dict)
                    # Completed/error downloads are moved to history by monitor thread
                
                return {
                    "queue": queue,
                    "active": active,
                    "history": self.history[:DOWNLOAD_HISTORY_LIMIT]
                }
                
            except Exception as e:
                print(f"[Aria2Manager] Error getting status: {e}")
                return {"queue": [], "active": [], "history": self.history[:DOWNLOAD_HISTORY_LIMIT]}
    
    def _aria2_download_to_dict(self, download: 'aria2p.Download') -> Dict[str, Any]:
        """Convert aria2p Download object to dictionary for UI."""
        progress = 0
        if download.total_length > 0:
            progress = (download.completed_length / download.total_length) * 100
        
        return {
            "id": f"aria2_{download.gid}",
            "aria2_gid": download.gid,
            "filename": download.name or os.path.basename(download.files[0].path) if download.files else "Unknown",
            "status": download.status,
            "progress": min(progress, 100.0),
            "speed": download.download_speed,
            "total_size": download.total_length,
            "downloaded": download.completed_length,
            "error": download.error_message if download.error_code else None,
            "connection_type": "Aria2",
            "connections": download.connections if hasattr(download, 'connections') else 0,
        }
    
    def _monitor_downloads(self):
        """Monitor aria2 downloads and update history."""
        print("[Aria2Manager] Monitor thread started")
        
        while self.running:
            try:
                if not self._ensure_daemon_running():
                    time.sleep(5)
                    continue
                
                # Get completed/failed downloads
                all_downloads = self.client.get_downloads()
                stopped_downloads = [d for d in all_downloads if d.status in ["complete", "error", "removed"]]
                
                with self.lock:
                    for download in stopped_downloads:
                        # Check if already in history
                        if any(item.get("aria2_gid") == download.gid for item in self.history):
                            continue
                        
                        # Convert to history format
                        download_dict = self._aria2_download_to_dict(download)
                        download_dict["end_time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                        
                        if download.status == "complete":
                            download_dict["status"] = "completed"
                            download_dict["progress"] = 100.0
                            
                            # Handle metadata and preview download
                            self._handle_completed_download(download_dict, download)
                            
                        elif download.status == "error":
                            download_dict["status"] = "failed"
                        elif download.status == "removed":
                            download_dict["status"] = "cancelled"
                        
                        self._add_to_history(download_dict)
                        
                        # Remove from aria2's download list
                        try:
                            self.client.remove_download_result(download)
                        except:
                            pass  # Ignore errors removing from result list
                
                time.sleep(2)  # Check every 2 seconds
                
            except Exception as e:
                print(f"[Aria2Manager] Monitor error: {e}")
                time.sleep(5)
        
        print("[Aria2Manager] Monitor thread stopped")
    
    def _handle_completed_download(self, download_dict: Dict[str, Any], aria2_download: 'aria2p.Download'):
        """Handle post-download tasks like metadata and preview."""
        try:
            if aria2_download.files:
                output_path = aria2_download.files[0].path
                download_dict["output_path"] = output_path
                
                # Try to find original download_info for metadata
                # This is a limitation - we need to store more metadata with aria2 downloads
                # For now, we'll skip metadata saving unless we can match it
                print(f"[Aria2Manager] Download completed: {output_path}")
                
        except Exception as e:
            print(f"[Aria2Manager] Error handling completed download: {e}")
    
    def _add_to_history(self, download_info: Dict[str, Any]):
        """Add item to history and save to file."""
        # Ensure end_time is set
        if "end_time" not in download_info or download_info["end_time"] is None:
            download_info["end_time"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        
        # Add to history
        self.history.insert(0, download_info)
        
        # Trim history
        if len(self.history) > DOWNLOAD_HISTORY_LIMIT:
            self.history = self.history[:DOWNLOAD_HISTORY_LIMIT]
        
        # Save to file
        self._save_history_to_file()
    
    def _load_history_from_file(self):
        """Load download history from JSON file."""
        if not os.path.exists(HISTORY_FILE_PATH):
            print(f"[Aria2Manager] History file not found, starting with empty history.")
            self.history = []
            return
        
        try:
            with open(HISTORY_FILE_PATH, 'r', encoding='utf-8') as f:
                loaded_data = json.load(f)
            
            if isinstance(loaded_data, list):
                self.history = loaded_data[:DOWNLOAD_HISTORY_LIMIT]
                print(f"[Aria2Manager] Loaded {len(self.history)} items from history.")
            else:
                print(f"[Aria2Manager] Invalid history file format, starting fresh.")
                self.history = []
                
        except Exception as e:
            print(f"[Aria2Manager] Error loading history: {e}")
            self.history = []
    
    def _save_history_to_file(self):
        """Save history to JSON file."""
        try:
            history_to_save = self.history[:DOWNLOAD_HISTORY_LIMIT]
            
            os.makedirs(os.path.dirname(HISTORY_FILE_PATH), exist_ok=True)
            
            temp_file_path = HISTORY_FILE_PATH + ".tmp"
            with open(temp_file_path, 'w', encoding='utf-8') as f:
                json.dump(history_to_save, f, indent=2, ensure_ascii=False)
            
            os.replace(temp_file_path, HISTORY_FILE_PATH)
            
        except Exception as e:
            print(f"[Aria2Manager] Error saving history: {e}")
    
    def clear_history(self) -> Dict[str, Any]:
        """Clear download history."""
        try:
            with self.lock:
                cleared_count = len(self.history)
                self.history = []
                
                if os.path.exists(HISTORY_FILE_PATH):
                    os.remove(HISTORY_FILE_PATH)
                    
                return {"success": True, "message": f"Cleared {cleared_count} history items."}
                
        except Exception as e:
            return {"success": False, "error": f"Failed to clear history: {e}"}
    
    def retry_download(self, original_download_id: str) -> Dict[str, Any]:
        """Retry a failed download."""
        with self.lock:
            # Find original download in history
            original_info = None
            for item in self.history:
                if item.get("id") == original_download_id:
                    original_info = item
                    break
            
            if not original_info:
                return {"success": False, "error": "Original download not found in history"}
            
            if original_info.get("status") not in ["failed", "cancelled"]:
                return {"success": False, "error": "Can only retry failed or cancelled downloads"}
            
            try:
                # Create new download info
                retry_info = original_info.copy()
                retry_info.pop("id", None)
                retry_info.pop("aria2_gid", None)
                retry_info["force_redownload"] = True
                
                # Queue new download
                new_id = self.add_to_queue(retry_info)
                
                # Remove original from history
                self.history = [item for item in self.history if item.get("id") != original_download_id]
                self._save_history_to_file()
                
                return {
                    "success": True,
                    "message": "Retry initiated. Original removed from history.",
                    "new_download_id": new_id
                }
                
            except Exception as e:
                return {"success": False, "error": f"Failed to retry download: {e}"}
    
    def open_containing_folder(self, download_id: str) -> Dict[str, Any]:
        """Open the folder containing a completed download."""
        # Find download in history
        download_info = None
        for item in self.history:
            if item.get("id") == download_id:
                download_info = item
                break
        
        if not download_info:
            return {"success": False, "error": "Download not found"}
        
        if download_info.get("status") != "completed":
            return {"success": False, "error": "Download not completed"}
        
        output_path = download_info.get("output_path")
        if not output_path or not os.path.exists(output_path):
            return {"success": False, "error": "Download file not found"}
        
        try:
            import platform
            import subprocess
            
            folder_path = os.path.dirname(output_path)
            system = platform.system()
            
            if system == "Windows":
                os.startfile(folder_path)
            elif system == "Darwin":  # macOS
                subprocess.check_call(["open", folder_path])
            elif system == "Linux":
                subprocess.check_call(["xdg-open", folder_path])
            else:
                return {"success": False, "error": f"Unsupported OS: {system}"}
            
            return {"success": True, "message": f"Opened directory: {folder_path}"}
            
        except Exception as e:
            return {"success": False, "error": f"Failed to open directory: {e}"}
    
    def shutdown(self):
        """Shutdown the manager and daemon."""
        print("[Aria2Manager] Shutting down...")
        self.running = False
        
        # Wait for monitor thread
        if hasattr(self, 'monitor_thread') and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=3)
        
        # Shutdown daemon
        if self.daemon:
            self.daemon.shutdown()
        
        print("[Aria2Manager] Shutdown complete")

# Global manager instance
_global_manager: Optional[Aria2DownloadManager] = None

def get_aria2_manager() -> Aria2DownloadManager:
    """Get or create the global aria2 manager instance."""
    global _global_manager
    if _global_manager is None:
        _global_manager = Aria2DownloadManager()
    return _global_manager

def shutdown_aria2_manager():
    """Shutdown the global manager."""
    global _global_manager
    if _global_manager:
        _global_manager.shutdown()
        _global_manager = None

# Register cleanup
import atexit
atexit.register(shutdown_aria2_manager)