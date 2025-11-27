"""
ISO Server Module
==================
Simple HTTP server to serve ISO files to iDRAC virtual media.
"""

import http.server
import socketserver
import threading
import os
import socket
from pathlib import Path


class ISOServer:
    """HTTP server to serve ISO files for virtual media mounting"""
    
    def __init__(self, iso_directory: str, port: int = 8888):
        """
        Initialize ISO server
        
        Args:
            iso_directory: Directory containing ISO files
            port: Port to serve on (default 8888)
        """
        self.iso_directory = iso_directory
        self.port = port
        self.server = None
        self.thread = None
        
        # Create directory if it doesn't exist
        Path(iso_directory).mkdir(parents=True, exist_ok=True)
    
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
        """Start HTTP server to serve ISOs"""
        # Change to ISO directory for serving
        os.chdir(self.iso_directory)
        
        # Create handler
        handler = http.server.SimpleHTTPRequestHandler
        
        # Create server
        self.server = socketserver.TCPServer(("0.0.0.0", self.port), handler)
        
        # Start server in background thread
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        
        local_ip = self.get_local_ip()
        print(f"ISO Server started: http://{local_ip}:{self.port}")
    
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
        return f"http://{local_ip}:{self.port}/{filename}"
    
    def list_isos(self):
        """List all ISO files in the directory"""
        iso_dir = Path(self.iso_directory)
        if not iso_dir.exists():
            return []
        
        return [f.name for f in iso_dir.glob("*.iso")]
