"""
Legacy SSL Adapter for iDRAC 8 Compatibility
=============================================

iDRAC 8 firmware (2.x) uses older TLS protocols (TLSv1.0/TLSv1.1) that modern 
Python/OpenSSL rejects by default. This adapter enables legacy renegotiation 
and older cipher suites for compatibility with older iDRAC generations.

Usage:
    from job_executor.legacy_ssl_adapter import LegacySSLAdapter
    
    session = requests.Session()
    session.mount('https://', LegacySSLAdapter())
    response = session.get('https://idrac-ip/redfish/v1/')
"""

import ssl
import requests
from requests.adapters import HTTPAdapter

try:
    from urllib3.util.ssl_ import create_urllib3_context
except ImportError:
    # Fallback for older urllib3 versions
    from urllib3.util import ssl_
    create_urllib3_context = ssl_.create_urllib3_context


class LegacySSLAdapter(HTTPAdapter):
    """
    HTTPAdapter that enables legacy TLS for older iDRAC compatibility.
    
    Supports:
    - TLSv1.0, TLSv1.1, TLSv1.2 (for iDRAC 7/8 with old firmware)
    - Legacy cipher suites
    - Unsafe legacy renegotiation (required for some iDRAC 8)
    
    This adapter should ONLY be used for servers that fail with modern TLS.
    iDRAC 9+ servers should use standard connections for security.
    """
    
    def __init__(self, *args, **kwargs):
        self.ssl_context = self._create_legacy_context()
        super().__init__(*args, **kwargs)
    
    def _create_legacy_context(self) -> ssl.SSLContext:
        """Create an SSL context with legacy TLS support"""
        ctx = create_urllib3_context()
        
        # Enable legacy renegotiation (OP_LEGACY_SERVER_CONNECT = 0x4)
        # Required for iDRAC 8 with older firmware that uses insecure renegotiation
        try:
            ctx.options |= 0x4  # ssl.OP_LEGACY_SERVER_CONNECT
        except Exception:
            pass  # Some OpenSSL versions may not support this
        
        # Set minimum TLS version to 1.0 for iDRAC 8 compatibility
        # Note: TLSv1.0 is deprecated but required for older iDRAC
        try:
            ctx.minimum_version = ssl.TLSVersion.TLSv1
        except AttributeError:
            # Python < 3.7 compatibility
            ctx.options &= ~ssl.OP_NO_SSLv3
        
        # Don't verify certificates (iDRAC uses self-signed certs)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        
        # Use a permissive cipher list that includes older ciphers
        # iDRAC 8 may not support modern ciphers
        try:
            ctx.set_ciphers('DEFAULT:@SECLEVEL=1')
        except ssl.SSLError:
            # Fallback if SECLEVEL not supported
            try:
                ctx.set_ciphers('DEFAULT')
            except Exception:
                pass
        
        return ctx
    
    def init_poolmanager(self, *args, **kwargs):
        """Initialize pool manager with legacy SSL context"""
        kwargs['ssl_context'] = self.ssl_context
        return super().init_poolmanager(*args, **kwargs)
    
    def proxy_manager_for(self, proxy, **proxy_kwargs):
        """Initialize proxy manager with legacy SSL context"""
        proxy_kwargs['ssl_context'] = self.ssl_context
        return super().proxy_manager_for(proxy, **proxy_kwargs)


def create_legacy_session() -> requests.Session:
    """
    Create a requests.Session configured for iDRAC 8 legacy TLS.
    
    Returns:
        A session that can connect to iDRAC 8 with older firmware.
    """
    session = requests.Session()
    adapter = LegacySSLAdapter()
    session.mount('https://', adapter)
    session.verify = False
    return session
