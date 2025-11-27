"""
Media Server Module
===================
HTTP server to serve ISO files and Dell Update Packages (DUPs) to iDRAC.
Extends the original ISO server to support firmware repository.
"""

import http.server
import socketserver
import threading
import os
import socket
from pathlib import Path


class MediaServer:
    """HTTP server to serve ISO files and firmware packages"""
    
    def __init__(self, iso_directory: str, firmware_directory: str, port: int = 8888):
        """
        Initialize media server
        
        Args:
            iso_directory: Directory containing ISO files
            firmware_directory: Directory containing DUP firmware files
            port: Port to serve on (default 8888)
        """
        self.iso_directory = iso_directory
        self.firmware_directory = firmware_directory
        self.port = port
        self.server = None
        self.thread = None
        
        # Create directories if they don't exist
        Path(iso_directory).mkdir(parents=True, exist_ok=True)
        Path(firmware_directory).mkdir(parents=True, exist_ok=True)
    
    def get_local_ip(self) -> str:
        """Get the local IP address of this machine"""
        try:
            # Create a socket connection to determine local IP
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
            s.close()
            return local_ip
        except Exception:
            return "127.0.0.1"
    
    def start(self):
        """Start HTTP server to serve media files"""
        # Create a custom handler that serves from multiple directories
        class MediaHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, iso_dir=None, firmware_dir=None, **kwargs):
                self.iso_dir = iso_dir
                self.firmware_dir = firmware_dir
                super().__init__(*args, **kwargs)
            
            def translate_path(self, path):
                # Route /isos/* to ISO directory
                if path.startswith('/isos/'):
                    path = path[6:]  # Remove /isos/
                    return os.path.join(self.iso_dir, path.lstrip('/'))
                # Route /firmware/* to firmware directory
                elif path.startswith('/firmware/'):
                    path = path[10:]  # Remove /firmware/
                    return os.path.join(self.firmware_dir, path.lstrip('/'))
                # Default to ISO directory for backward compatibility
                else:
                    return os.path.join(self.iso_dir, path.lstrip('/'))
        
        # Create handler with our directories
        def handler_factory(*args, **kwargs):
            return MediaHandler(*args, iso_dir=self.iso_directory, 
                              firmware_dir=self.firmware_directory, **kwargs)
        
        # Create server
        self.server = socketserver.TCPServer(("0.0.0.0", self.port), handler_factory)
        
        # Start server in background thread
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        
        local_ip = self.get_local_ip()
        print(f"Media Server started: http://{local_ip}:{self.port}")
        print(f"  - ISOs: http://{local_ip}:{self.port}/isos/")
        print(f"  - Firmware: http://{local_ip}:{self.port}/firmware/")
    
    def stop(self):
        """Stop HTTP server"""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
    
    def get_iso_url(self, filename: str) -> str:
        """
        Generate URL that iDRAC can use to fetch the ISO
        
        Args:
            filename: Name of the ISO file
            
        Returns:
            Full HTTP URL to the ISO
        """
        local_ip = self.get_local_ip()
        return f"http://{local_ip}:{self.port}/isos/{filename}"
    
    def get_dup_url(self, filename: str) -> str:
        """
        Generate URL that iDRAC can use to fetch the DUP firmware package
        
        Args:
            filename: Name of the DUP file (.exe)
            
        Returns:
            Full HTTP URL to the DUP
        """
        local_ip = self.get_local_ip()
        return f"http://{local_ip}:{self.port}/firmware/{filename}"
    
    def list_isos(self):
        """List all ISO files in the ISO directory"""
        iso_dir = Path(self.iso_directory)
        if not iso_dir.exists():
            return []
        
        return [f.name for f in iso_dir.glob("*.iso")]
    
    def list_firmware(self):
        """List all firmware DUP files in the firmware directory"""
        firmware_dir = Path(self.firmware_directory)
        if not firmware_dir.exists():
            return []
        
        return [f.name for f in firmware_dir.glob("*.exe")]
