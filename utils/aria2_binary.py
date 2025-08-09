# ================================================
# File: utils/aria2_binary.py
# Aria2 Binary Detection and Management Utility
# ================================================

import os
import sys
import platform
import subprocess
import shutil
from pathlib import Path
from typing import Optional, Tuple
import requests
import tarfile
import zipfile
import tempfile

class Aria2BinaryManager:
    """Manages aria2c binary detection, download, and installation."""
    
    # Official aria2 release URLs
    ARIA2_RELEASES_API = "https://api.github.com/repos/aria2/aria2/releases/latest"
    
    def __init__(self, plugin_root: str):
        self.plugin_root = Path(plugin_root)
        self.bin_dir = self.plugin_root / "bin"
        self.system = platform.system().lower()
        self.machine = platform.machine().lower()
        
    def get_aria2c_path(self) -> Optional[str]:
        """Find aria2c binary in bundled binaries, plugin bin directory, or system PATH."""
        # 1. Check bundled binaries first
        bundled_binary = self._get_bundled_binary_path()
        if bundled_binary and bundled_binary.exists() and bundled_binary.is_file():
            try:
                # Verify it works
                result = subprocess.run([str(bundled_binary), "--version"], 
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    return str(bundled_binary)
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass
        
        # 2. Check plugin bin directory (for legacy downloaded binaries)
        plugin_binary = self._get_plugin_binary_path()
        if plugin_binary and plugin_binary.exists() and plugin_binary.is_file():
            try:
                # Verify it works
                result = subprocess.run([str(plugin_binary), "--version"], 
                                      capture_output=True, timeout=5)
                if result.returncode == 0:
                    return str(plugin_binary)
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass
        
        # 3. Check system PATH as final fallback
        system_binary = shutil.which("aria2c")
        if system_binary:
            return system_binary
            
        return None
    
    def _get_bundled_binary_path(self) -> Optional[Path]:
        """Get the path to the appropriate bundled aria2c binary for this platform."""
        # Map platform and architecture to bundled binary paths
        if self.system == "windows":
            if "64" in self.machine or "amd64" in self.machine:
                return self.bin_dir / "windows" / "x64" / "aria2c.exe"
            else:
                return self.bin_dir / "windows" / "x86" / "aria2c.exe"
        
        elif self.system == "darwin":  # macOS
            if "arm" in self.machine or "aarch64" in self.machine:
                return self.bin_dir / "darwin" / "arm64" / "aria2c"
            else:
                return self.bin_dir / "darwin" / "x86_64" / "aria2c"
        
        elif self.system == "linux":
            if "aarch64" in self.machine or "arm64" in self.machine:
                return self.bin_dir / "linux" / "aarch64" / "aria2c"
            elif "64" in self.machine or "x86_64" in self.machine:
                return self.bin_dir / "linux" / "x86_64" / "aria2c"
        
        # Other platforms don't have bundled binaries
        return None
    
    def _get_plugin_binary_path(self) -> Path:
        """Get the expected path for aria2c in plugin bin directory (legacy)."""
        executable = "aria2c.exe" if self.system == "windows" else "aria2c"
        return self.bin_dir / executable
    
    def is_aria2_available(self) -> Tuple[bool, Optional[str]]:
        """Check if aria2c is available and return path if found."""
        path = self.get_aria2c_path()
        return (path is not None, path)
    
    def _get_download_info(self) -> Optional[Tuple[str, str]]:
        """Get download URL and filename for current platform."""
        try:
            response = requests.get(self.ARIA2_RELEASES_API, timeout=10)
            response.raise_for_status()
            release_data = response.json()
            
            assets = release_data.get("assets", [])
            
            # Platform-specific asset matching
            patterns = self._get_asset_patterns()
            
            for pattern in patterns:
                for asset in assets:
                    name = asset["name"].lower()
                    if all(p in name for p in pattern):
                        return asset["browser_download_url"], asset["name"]
                        
        except Exception as e:
            print(f"[Aria2Binary] Error fetching release info: {e}")
            
        return None
    
    def _get_asset_patterns(self) -> list:
        """Get asset name patterns for current platform."""
        if self.system == "windows":
            if "64" in self.machine or "amd64" in self.machine:
                return [["win", "64"], ["win", "x64"], ["windows", "64"]]
            else:
                return [["win", "32"], ["windows", "32"]]
                
        elif self.system == "darwin":  # macOS
            if "arm" in self.machine or "aarch64" in self.machine:
                return [["osx"], ["mac"], ["darwin"]]  # ARM and Intel use same builds on macOS
            else:
                return [["osx"], ["mac"], ["darwin"]]
            
        elif self.system == "linux":
            if "64" in self.machine or "x86_64" in self.machine:
                return [["linux", "64"], ["linux", "x86_64"]]
            elif "arm" in self.machine:
                if "64" in self.machine:
                    return [["linux", "arm64"], ["linux", "aarch64"]]
                else:
                    return [["linux", "arm"]]
            else:
                return [["linux", "32"], ["linux", "i386"]]
                
        return []
    
    def download_and_install_aria2(self) -> Tuple[bool, str]:
        """Download and install aria2c binary to plugin bin directory."""
        # Check if we already have a bundled binary for this platform
        bundled_path = self._get_bundled_binary_path()
        if bundled_path:
            return False, f"This platform should use the bundled aria2 binary at: {bundled_path}. If it's missing, please reinstall Civicomfy."
            
        download_info = self._get_download_info()
        if not download_info:
            return False, "Could not find suitable aria2 release for your platform"
            
        download_url, filename = download_info
        print(f"[Aria2Binary] Downloading aria2: {filename}")
        
        try:
            # Create bin directory
            self.bin_dir.mkdir(parents=True, exist_ok=True)
            
            # Download to temp file
            with tempfile.NamedTemporaryFile(delete=False, suffix=filename[-4:]) as temp_file:
                response = requests.get(download_url, stream=True, timeout=30)
                response.raise_for_status()
                
                for chunk in response.iter_content(chunk_size=8192):
                    temp_file.write(chunk)
                    
                temp_path = Path(temp_file.name)
            
            # Extract archive
            success = self._extract_and_install(temp_path, filename)
            
            # Cleanup temp file
            try:
                temp_path.unlink()
            except:
                pass
                
            if success:
                # Verify installation
                available, path = self.is_aria2_available()
                if available:
                    return True, f"Successfully installed aria2c at: {path}"
                else:
                    return False, "Installation completed but aria2c not working"
            else:
                return False, "Failed to extract aria2c from archive"
                
        except Exception as e:
            return False, f"Download/installation failed: {e}"
    
    def _extract_and_install(self, archive_path: Path, filename: str) -> bool:
        """Extract aria2c from downloaded archive."""
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_dir_path = Path(temp_dir)
                
                # Extract archive
                if filename.endswith('.tar.gz') or filename.endswith('.tar.xz'):
                    with tarfile.open(archive_path, 'r:*') as tar:
                        tar.extractall(temp_dir_path)
                elif filename.endswith('.zip'):
                    with zipfile.ZipFile(archive_path, 'r') as zip_file:
                        zip_file.extractall(temp_dir_path)
                else:
                    return False
                
                # Find aria2c binary in extracted files
                aria2c_binary = self._find_aria2c_in_directory(temp_dir_path)
                if not aria2c_binary:
                    return False
                
                # Copy to plugin bin directory
                target_path = self._get_plugin_binary_path()
                shutil.copy2(aria2c_binary, target_path)
                
                # Make executable on Unix systems
                if self.system != "windows":
                    target_path.chmod(0o755)
                
                return True
                
        except Exception as e:
            print(f"[Aria2Binary] Extraction error: {e}")
            return False
    
    def _find_aria2c_in_directory(self, directory: Path) -> Optional[Path]:
        """Recursively find aria2c binary in directory."""
        executable_name = "aria2c.exe" if self.system == "windows" else "aria2c"
        
        for root, dirs, files in os.walk(directory):
            for file in files:
                if file == executable_name:
                    file_path = Path(root) / file
                    if file_path.is_file():
                        return file_path
                        
        return None
    
    def get_version(self, aria2c_path: str) -> Optional[str]:
        """Get version of aria2c binary."""
        try:
            result = subprocess.run([aria2c_path, "--version"], 
                                  capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                # Parse version from output
                lines = result.stdout.strip().split('\n')
                if lines:
                    first_line = lines[0]
                    if 'aria2' in first_line.lower():
                        # Extract version number
                        parts = first_line.split()
                        for part in parts:
                            if part.replace('.', '').replace('-', '').isdigit() or \
                               any(char.isdigit() for char in part):
                                if '.' in part:
                                    return part
                return first_line  # Fallback to full first line
        except Exception:
            pass
            
        return None

# Global instance for easy access
def get_aria2_binary_manager(plugin_root: str) -> Aria2BinaryManager:
    """Get a shared instance of Aria2BinaryManager."""
    if not hasattr(get_aria2_binary_manager, '_instance'):
        get_aria2_binary_manager._instance = Aria2BinaryManager(plugin_root)
    return get_aria2_binary_manager._instance