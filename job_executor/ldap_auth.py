"""
FreeIPA/LDAP Authentication Module
==================================
Handles LDAP authentication against FreeIPA servers from the local network.

This module enables the Dell Server Manager Job Executor to authenticate users
against on-premise FreeIPA LDAP servers via the local network, supporting:
- LDAPS (TLS-encrypted LDAP connections)
- Custom CA certificate validation
- FreeIPA-specific attribute extraction (uid, groups, memberOf)
- Service account-based user sync operations
"""

import ssl
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime

# Conditional import for ldap3
try:
    from ldap3 import Server, Connection, ALL, SUBTREE, Tls
    from ldap3.core.exceptions import LDAPException, LDAPBindError
    LDAP3_AVAILABLE = True
except ImportError:
    LDAP3_AVAILABLE = False

logger = logging.getLogger(__name__)


class FreeIPAAuthenticator:
    """
    Authenticates users against FreeIPA LDAP server.
    
    This class handles LDAP bind operations to authenticate users,
    extract user attributes, and retrieve group memberships from FreeIPA.
    """
    
    def __init__(
        self,
        server_host: str,
        base_dn: str,
        user_search_base: str = "cn=users,cn=accounts",
        group_search_base: str = "cn=groups,cn=accounts",
        use_ldaps: bool = True,
        ldaps_port: int = 636,
        ldap_port: int = 389,
        verify_certificate: bool = True,
        ca_certificate: Optional[str] = None,
        connection_timeout: int = 10,
    ):
        """
        Initialize FreeIPA authenticator.
        
        Args:
            server_host: FreeIPA server hostname or IP
            base_dn: LDAP base DN (e.g., 'dc=example,dc=com')
            user_search_base: User search base relative to base_dn
            group_search_base: Group search base relative to base_dn
            use_ldaps: Use LDAPS (TLS) connection
            ldaps_port: LDAPS port (default 636)
            ldap_port: LDAP port (default 389)
            verify_certificate: Verify TLS certificate
            ca_certificate: Path to CA certificate file for validation
            connection_timeout: Connection timeout in seconds
        """
        if not LDAP3_AVAILABLE:
            raise ImportError("ldap3 library required: pip install ldap3")
        
        self.server_host = server_host
        self.base_dn = base_dn
        self.user_search_base = user_search_base
        self.group_search_base = group_search_base
        self.use_ldaps = use_ldaps
        self.port = ldaps_port if use_ldaps else ldap_port
        self.verify_certificate = verify_certificate
        self.ca_certificate = ca_certificate
        self.connection_timeout = connection_timeout
        
        self._server = None
    
    def _get_server(self) -> Server:
        """Get or create LDAP server connection."""
        if self._server is None:
            tls_config = None
            if self.use_ldaps:
                tls_config = Tls(
                    validate=ssl.CERT_REQUIRED if self.verify_certificate else ssl.CERT_NONE,
                    ca_certs_file=self.ca_certificate if self.ca_certificate else None,
                )
            
            self._server = Server(
                self.server_host,
                port=self.port,
                use_ssl=self.use_ldaps,
                tls=tls_config,
                get_info=ALL,
                connect_timeout=self.connection_timeout,
            )
        return self._server
    
    def _build_user_dn(self, username: str) -> str:
        """Build user DN from username for FreeIPA."""
        return f"uid={username},{self.user_search_base},{self.base_dn}"
    
    def test_connection(self, bind_dn: str, bind_password: str) -> Dict:
        """
        Test LDAP connection with service account credentials.
        
        Args:
            bind_dn: Service account DN
            bind_password: Service account password
            
        Returns:
            Dict with success, message, server_info, response_time_ms
        """
        start_time = datetime.now()
        try:
            server = self._get_server()
            conn = Connection(
                server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
                raise_exceptions=True,
            )
            
            # Get server info
            server_info = {
                "vendor": str(server.info.vendor_name) if server.info else "Unknown",
                "version": str(server.info.vendor_version) if server.info else "Unknown",
                "naming_contexts": list(server.info.naming_contexts) if server.info else [],
            }
            
            conn.unbind()
            
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            return {
                "success": True,
                "message": "Connection successful",
                "server_info": server_info,
                "response_time_ms": elapsed_ms,
            }
        except LDAPException as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            return {
                "success": False,
                "message": str(e),
                "error_type": type(e).__name__,
                "response_time_ms": elapsed_ms,
            }
    
    def authenticate_user(
        self,
        username: str,
        password: str,
        service_bind_dn: Optional[str] = None,
        service_bind_password: Optional[str] = None,
    ) -> Dict:
        """
        Authenticate user against FreeIPA via LDAP bind.
        
        Args:
            username: Username (uid) to authenticate
            password: User's password
            service_bind_dn: Optional service account DN (unused in direct bind)
            service_bind_password: Optional service account password (unused)
            
        Returns:
            Dict with:
            - success: bool
            - user_dn: str (if successful)
            - user_info: dict with uid, full_name, email, title, department
            - groups: list of group DNs
            - error: str (if failed)
            - response_time_ms: int
        """
        start_time = datetime.now()
        
        try:
            server = self._get_server()
            user_dn = self._build_user_dn(username)
            
            # Attempt direct bind with user credentials
            conn = Connection(
                server,
                user=user_dn,
                password=password,
                auto_bind=True,
                raise_exceptions=True,
            )
            
            # Fetch user attributes
            user_filter = f"(uid={username})"
            user_attrs = [
                "uid", "cn", "sn", "givenName", "mail", 
                "memberOf", "title", "departmentNumber"
            ]
            
            conn.search(
                search_base=f"{self.user_search_base},{self.base_dn}",
                search_filter=user_filter,
                search_scope=SUBTREE,
                attributes=user_attrs,
            )
            
            if not conn.entries:
                conn.unbind()
                return {
                    "success": False,
                    "error": "User not found after successful bind",
                }
            
            user_entry = conn.entries[0]
            
            # Extract user info
            user_info = {
                "uid": str(user_entry.uid) if hasattr(user_entry, 'uid') else username,
                "full_name": str(user_entry.cn) if hasattr(user_entry, 'cn') else None,
                "email": str(user_entry.mail) if hasattr(user_entry, 'mail') else None,
                "first_name": str(user_entry.givenName) if hasattr(user_entry, 'givenName') else None,
                "last_name": str(user_entry.sn) if hasattr(user_entry, 'sn') else None,
                "title": str(user_entry.title) if hasattr(user_entry, 'title') else None,
                "department": str(user_entry.departmentNumber) if hasattr(user_entry, 'departmentNumber') else None,
            }
            
            # Extract groups
            groups = []
            if hasattr(user_entry, 'memberOf'):
                groups = [str(g) for g in user_entry.memberOf]
            
            conn.unbind()
            
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            return {
                "success": True,
                "user_dn": user_dn,
                "user_info": user_info,
                "groups": groups,
                "response_time_ms": elapsed_ms,
            }
            
        except LDAPBindError as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            return {
                "success": False,
                "error": "Invalid credentials",
                "error_details": str(e),
                "response_time_ms": elapsed_ms,
            }
        except LDAPException as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            return {
                "success": False,
                "error": f"LDAP error: {str(e)}",
                "error_type": type(e).__name__,
                "response_time_ms": elapsed_ms,
            }
        except Exception as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}",
                "error_type": type(e).__name__,
                "response_time_ms": elapsed_ms,
            }
    
    def get_user_groups(
        self,
        username: str,
        bind_dn: str,
        bind_password: str,
    ) -> List[str]:
        """
        Get all groups for a user using service account.
        
        Args:
            username: Username (uid) to query
            bind_dn: Service account DN
            bind_password: Service account password
            
        Returns:
            List of group DNs the user belongs to
        """
        try:
            server = self._get_server()
            conn = Connection(
                server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
            )
            
            user_dn = self._build_user_dn(username)
            
            conn.search(
                search_base=user_dn,
                search_filter="(objectClass=*)",
                attributes=["memberOf"],
            )
            
            groups = []
            if conn.entries:
                entry = conn.entries[0]
                if hasattr(entry, 'memberOf'):
                    groups = [str(g) for g in entry.memberOf]
            
            conn.unbind()
            return groups
            
        except Exception as e:
            logger.error(f"Failed to get user groups: {e}")
            return []
    
    def search_groups(
        self,
        bind_dn: str,
        bind_password: str,
        search_term: str = "*",
        max_results: int = 100,
    ) -> List[Dict]:
        """
        Search for groups in FreeIPA.
        
        Args:
            bind_dn: Service account DN
            bind_password: Service account password
            search_term: Search pattern (supports wildcards)
            max_results: Maximum number of results
            
        Returns:
            List of group dicts with dn, cn, description, member_count
        """
        try:
            server = self._get_server()
            conn = Connection(
                server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
            )
            
            # FreeIPA group filter with search term
            group_filter = f"(&(objectClass=groupOfNames)(cn=*{search_term}*))"
            
            group_attrs = ["cn", "description", "member"]
            
            conn.search(
                search_base=f"{self.group_search_base},{self.base_dn}",
                search_filter=group_filter,
                search_scope=SUBTREE,
                attributes=group_attrs,
                size_limit=max_results,
            )
            
            groups = []
            for entry in conn.entries:
                group = {
                    "dn": str(entry.entry_dn),
                    "cn": str(entry.cn) if hasattr(entry, 'cn') else None,
                    "description": str(entry.description) if hasattr(entry, 'description') else None,
                    "member_count": len(entry.member) if hasattr(entry, 'member') else 0,
                }
                if group["cn"]:
                    groups.append(group)
            
            conn.unbind()
            return groups
            
        except Exception as e:
            logger.error(f"Failed to search groups: {e}")
            return []
    
    def sync_all_users(
        self,
        bind_dn: str,
        bind_password: str,
        user_filter: str = "(objectClass=person)",
    ) -> List[Dict]:
        """
        Sync all users from FreeIPA using service account.
        
        Args:
            bind_dn: Service account DN
            bind_password: Service account password
            user_filter: LDAP filter for users
            
        Returns:
            List of user dicts with dn, uid, full_name, email, groups, disabled
        """
        try:
            server = self._get_server()
            conn = Connection(
                server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
            )
            
            user_attrs = [
                "uid", "cn", "sn", "givenName", "mail",
                "memberOf", "title", "departmentNumber", "nsAccountLock"
            ]
            
            conn.search(
                search_base=f"{self.user_search_base},{self.base_dn}",
                search_filter=user_filter,
                search_scope=SUBTREE,
                attributes=user_attrs,
            )
            
            users = []
            for entry in conn.entries:
                user = {
                    "dn": str(entry.entry_dn),
                    "uid": str(entry.uid) if hasattr(entry, 'uid') else None,
                    "full_name": str(entry.cn) if hasattr(entry, 'cn') else None,
                    "email": str(entry.mail) if hasattr(entry, 'mail') else None,
                    "groups": [str(g) for g in entry.memberOf] if hasattr(entry, 'memberOf') else [],
                    "disabled": str(entry.nsAccountLock).lower() == 'true' if hasattr(entry, 'nsAccountLock') else False,
                }
                if user["uid"]:
                    users.append(user)
            
            conn.unbind()
            return users
            
        except Exception as e:
            logger.error(f"Failed to sync users: {e}")
            return []
