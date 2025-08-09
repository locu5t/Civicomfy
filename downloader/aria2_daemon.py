# ================================================
# File: downloader/aria2_daemon.py
# Aria2 Daemon Lifecycle Management
# ================================================

import os
import sys
import time
import socket
import subprocess
import threading
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any
import json
import atexit

from ..config import PLUGIN_ROOT
from ..utils.aria2_binary import get_aria2_binary_manager

class Aria2Daemon:
    """Manages aria2c daemon process lifecycle."""
    
    def __init__(self, 
                 rpc_port: int = 6800,
                 rpc_secret: Optional[str] = None,
                 max_concurrent_downloads: int = 5,
                 max_connection_per_server: int = 16,
                 min_split_size: str = "1M",
                 download_dir: Optional[str] = None):
        """Initialize Aria2 daemon configuration."""
        self.rpc_port = rpc_port
        self.rpc_secret = rpc_secret or self._generate_secret()
        self.max_concurrent_downloads = max_concurrent_downloads
        self.max_connection_per_server = max_connection_per_server
        self.min_split_size = min_split_size
        self.download_dir = download_dir or str(Path(PLUGIN_ROOT) / "downloads")
        
        # Process management
        self.process: Optional[subprocess.Popen] = None
        self.is_running = False
        self.startup_timeout = 10  # seconds
        
        # Binary management
        self.binary_manager = get_aria2_binary_manager(PLUGIN_ROOT)
        self.aria2c_path: Optional[str] = None
        
        # Session management
        self.session_file = Path(PLUGIN_ROOT) / "aria2_session.txt"
        
        # Lock for thread safety
        self.lock = threading.Lock()
        
        # Register cleanup
        atexit.register(self.shutdown)
    
    def _generate_secret(self) -> str:
        """Generate a random secret token for RPC authentication."""
        import secrets
        return secrets.token_urlsafe(32)
    
    def _is_port_available(self, port: int) -> bool:
        """Check if a port is available for binding."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('localhost', port))
                return True
            except OSError:
                return False
    
    def _find_available_port(self, start_port: int = 6800, max_attempts: int = 10) -> int:
        """Find an available port starting from start_port."""
        for port in range(start_port, start_port + max_attempts):
            if self._is_port_available(port):
                return port
        raise RuntimeError(f"No available ports found in range {start_port}-{start_port + max_attempts}")
    
    def _ensure_aria2c_binary(self) -> bool:
        """Ensure aria2c binary is available, download if needed."""
        available, path = self.binary_manager.is_aria2_available()
        
        if available:
            self.aria2c_path = path
            version = self.binary_manager.get_version(path)
            print(f"[Aria2Daemon] Found aria2c: {path} (version: {version})")
            return True
        
        print("[Aria2Daemon] aria2c not found, attempting to download...")
        success, message = self.binary_manager.download_and_install_aria2()
        
        if success:
            available, path = self.binary_manager.is_aria2_available()
            if available:
                self.aria2c_path = path
                print(f"[Aria2Daemon] {message}")
                return True
        
        print(f"[Aria2Daemon] Failed to obtain aria2c: {message}")
        return False
    
    def _build_command(self) -> list:
        """Build aria2c command with configuration options."""
        if not self.aria2c_path:
            raise RuntimeError("aria2c binary path not set")
        
        # Ensure download directory exists
        os.makedirs(self.download_dir, exist_ok=True)
        
        cmd = [
            self.aria2c_path,
            "--enable-rpc",
            f"--rpc-listen-port={self.rpc_port}",
            "--rpc-listen-all=false",  # Only localhost for security
            "--rpc-allow-origin-all=true",
            f"--rpc-secret={self.rpc_secret}",
            f"--max-concurrent-downloads={self.max_concurrent_downloads}",
            f"--max-connection-per-server={self.max_connection_per_server}",
            f"--min-split-size={self.min_split_size}",
            f"--dir={self.download_dir}",
            "--continue=true",  # Resume incomplete downloads
            "--auto-file-renaming=false",  # Don't rename files automatically
            "--allow-overwrite=false",  # Don't overwrite existing files by default
            "--file-allocation=prealloc" if sys.platform != "win32" else "--file-allocation=falloc",
            "--check-integrity=true",  # Enable hash checking if available
            "--summary-interval=1",  # Update summary every second
            f"--save-session={self.session_file}",
            f"--input-file={self.session_file}",
            "--save-session-interval=30",  # Save session every 30 seconds
            "--quiet=true",  # Reduce log output
            "--console-log-level=warn",
        ]
        
        return cmd
    
    def start(self) -> bool:
        """Start the aria2c daemon process."""
        with self.lock:
            if self.is_running and self.process:
                print("[Aria2Daemon] Daemon already running")
                return True
            
            # Ensure binary is available
            if not self._ensure_aria2c_binary():
                return False
            
            # Find available port if current one is taken
            if not self._is_port_available(self.rpc_port):
                try:
                    new_port = self._find_available_port(self.rpc_port + 1)
                    print(f"[Aria2Daemon] Port {self.rpc_port} in use, using {new_port}")
                    self.rpc_port = new_port
                except RuntimeError as e:
                    print(f"[Aria2Daemon] {e}")
                    return False
            
            try:
                # Build command
                cmd = self._build_command()
                print(f"[Aria2Daemon] Starting daemon on port {self.rpc_port}")
                
                # Start process
                self.process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    stdin=subprocess.PIPE,
                    cwd=PLUGIN_ROOT
                )
                
                # Wait for daemon to start
                start_time = time.time()
                while time.time() - start_time < self.startup_timeout:
                    if self.process.poll() is not None:
                        # Process terminated
                        stdout, stderr = self.process.communicate()
                        print(f"[Aria2Daemon] Failed to start - stdout: {stdout.decode()}")
                        print(f"[Aria2Daemon] Failed to start - stderr: {stderr.decode()}")
                        return False
                    
                    # Check if RPC is responding
                    if self._test_rpc_connection():
                        self.is_running = True
                        print(f"[Aria2Daemon] Successfully started (PID: {self.process.pid})")
                        return True
                    
                    time.sleep(0.5)
                
                # Timeout reached
                print("[Aria2Daemon] Startup timeout reached")
                self.shutdown()
                return False
                
            except Exception as e:
                print(f"[Aria2Daemon] Failed to start: {e}")
                return False
    
    def _test_rpc_connection(self) -> bool:
        """Test if RPC interface is responding."""
        try:
            import requests
            url = f"http://localhost:{self.rpc_port}/jsonrpc"
            headers = {"Content-Type": "application/json"}
            
            payload = {
                "jsonrpc": "2.0",
                "method": "aria2.getVersion",
                "id": "test",
                "params": [f"token:{self.rpc_secret}"] if self.rpc_secret else []
            }
            
            response = requests.post(url, 
                                   data=json.dumps(payload), 
                                   headers=headers, 
                                   timeout=2)
            
            if response.status_code == 200:
                result = response.json()
                return "result" in result
                
        except Exception:
            pass
        
        return False
    
    def shutdown(self) -> bool:
        """Shutdown the aria2c daemon process."""
        with self.lock:
            if not self.is_running or not self.process:
                return True
            
            print("[Aria2Daemon] Shutting down daemon...")
            
            try:
                # Try graceful shutdown via RPC first
                self._graceful_shutdown_rpc()
                
                # Wait for process to terminate
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    print("[Aria2Daemon] Graceful shutdown timeout, forcing termination")
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        print("[Aria2Daemon] Terminate timeout, killing process")
                        self.process.kill()
                        self.process.wait()
                
                print("[Aria2Daemon] Daemon stopped")
                
            except Exception as e:
                print(f"[Aria2Daemon] Error during shutdown: {e}")
                if self.process:
                    try:
                        self.process.kill()
                        self.process.wait()
                    except:
                        pass
            finally:
                self.process = None
                self.is_running = False
                
            return True
    
    def _graceful_shutdown_rpc(self):
        """Attempt graceful shutdown via RPC."""
        try:
            import requests
            url = f"http://localhost:{self.rpc_port}/jsonrpc"
            headers = {"Content-Type": "application/json"}
            
            payload = {
                "jsonrpc": "2.0",
                "method": "aria2.shutdown",
                "id": "shutdown",
                "params": [f"token:{self.rpc_secret}"] if self.rpc_secret else []
            }
            
            requests.post(url, 
                         data=json.dumps(payload), 
                         headers=headers, 
                         timeout=3)
                         
        except Exception:
            pass  # Ignore errors, we'll force shutdown if needed
    
    def restart(self) -> bool:
        """Restart the daemon."""
        print("[Aria2Daemon] Restarting daemon...")
        if not self.shutdown():
            return False
        time.sleep(1)  # Brief pause between shutdown and startup
        return self.start()
    
    def get_rpc_url(self) -> str:
        """Get the RPC URL for connecting to the daemon."""
        return f"http://localhost:{self.rpc_port}/jsonrpc"
    
    def get_connection_info(self) -> Dict[str, Any]:
        """Get connection information for aria2p client."""
        return {
            "host": "localhost",
            "port": self.rpc_port,
            "secret": self.rpc_secret,
            "url": self.get_rpc_url()
        }
    
    def is_healthy(self) -> bool:
        """Check if daemon is running and healthy."""
        with self.lock:
            if not self.is_running or not self.process:
                return False
                
            # Check if process is still alive
            if self.process.poll() is not None:
                print("[Aria2Daemon] Process died unexpectedly")
                self.is_running = False
                return False
            
            # Test RPC connection
            return self._test_rpc_connection()

# Global daemon instance
_global_daemon: Optional[Aria2Daemon] = None

def get_aria2_daemon(**kwargs) -> Aria2Daemon:
    """Get or create the global aria2 daemon instance."""
    global _global_daemon
    if _global_daemon is None:
        _global_daemon = Aria2Daemon(**kwargs)
    return _global_daemon

def shutdown_global_daemon():
    """Shutdown the global daemon instance."""
    global _global_daemon
    if _global_daemon:
        _global_daemon.shutdown()
        _global_daemon = None

# Register cleanup
atexit.register(shutdown_global_daemon)