"""
Session Manager - Lightweight replacement for IdracThrottler

Provides:
- Per-IP requests.Session management
- Legacy TLS adapter support for iDRAC 8
- Session cleanup

Does NOT provide (intentionally removed):
- Rate limiting
- Circuit breakers
- Concurrency limits
- Exponential backoff
"""

import requests
from typing import Dict, Optional


class SessionManager:
    """
    Manages per-IP requests.Session objects with legacy TLS support.
    
    This is a lightweight replacement for IdracThrottler that only handles
    session management without any throttling or circuit breaker logic.
    """
    
    def __init__(self, verify_ssl: bool = False):
        """
        Initialize the session manager.
        
        Args:
            verify_ssl: Whether to verify SSL certificates (default False for self-signed)
        """
        self.sessions: Dict[str, requests.Session] = {}
        self.verify_ssl = verify_ssl
        
        if not verify_ssl:
            import urllib3
            urllib3.disable_warnings()
    
    def get_session(self, ip: str, legacy_ssl: bool = False) -> requests.Session:
        """
        Get or create a requests.Session for an IP.
        
        Args:
            ip: The iDRAC IP address
            legacy_ssl: If True, use legacy TLS adapter for iDRAC 8 compatibility
            
        Returns:
            Configured requests.Session object
        """
        cache_key = f"{ip}:{'legacy' if legacy_ssl else 'modern'}"
        
        if cache_key not in self.sessions:
            session = requests.Session()
            session.verify = self.verify_ssl
            
            if legacy_ssl:
                from job_executor.legacy_ssl_adapter import LegacySSLAdapter
                adapter = LegacySSLAdapter()
                session.mount('https://', adapter)
            
            self.sessions[cache_key] = session
        
        return self.sessions[cache_key]
    
    def close_session(self, ip: str, legacy_ssl: bool = False):
        """
        Close and cleanup session for an IP.
        
        Args:
            ip: The iDRAC IP address
            legacy_ssl: Whether this was a legacy SSL session
        """
        cache_key = f"{ip}:{'legacy' if legacy_ssl else 'modern'}"
        
        if cache_key in self.sessions:
            try:
                self.sessions[cache_key].close()
            except Exception:
                pass
            del self.sessions[cache_key]
    
    def close_all_sessions(self):
        """Close all active sessions."""
        for key in list(self.sessions.keys()):
            try:
                self.sessions[key].close()
            except Exception:
                pass
        self.sessions.clear()
    
    def make_request(
        self,
        method: str,
        url: str,
        ip: str,
        legacy_ssl: bool = False,
        **kwargs
    ) -> requests.Response:
        """
        Make an HTTP request using the session for the given IP.
        
        Args:
            method: HTTP method (GET, POST, PATCH, DELETE)
            url: Full URL to request
            ip: iDRAC IP address (used to get/create session)
            legacy_ssl: If True, use legacy TLS for iDRAC 8 compatibility
            **kwargs: Additional arguments for requests.request()
            
        Returns:
            requests.Response object
        """
        session = self.get_session(ip, legacy_ssl=legacy_ssl)
        
        # Set default timeout if not provided
        if 'timeout' not in kwargs:
            kwargs['timeout'] = (5, 30)  # 5s connect, 30s read
        
        # Ensure Accept header
        if 'headers' not in kwargs or kwargs['headers'] is None:
            kwargs['headers'] = {}
        if 'Accept' not in kwargs['headers']:
            kwargs['headers']['Accept'] = 'application/json'
        
        return session.request(method, url, **kwargs)
