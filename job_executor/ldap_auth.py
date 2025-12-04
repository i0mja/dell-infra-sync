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
- AD Trust users (users from trusted Active Directory domains)
- AD DC pass-through authentication for AD Trust users
- Identity normalization across multiple formats (bare, UPN, NT-style)
"""

from __future__ import annotations

import re
import ssl
import json
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime

# Conditional import for ldap3
try:
    from ldap3 import Server, Connection, ALL, SUBTREE, Tls
    from ldap3.core.exceptions import LDAPException, LDAPBindError
    LDAP3_AVAILABLE = True
except ImportError:
    LDAP3_AVAILABLE = False

# Import identity normalizer
try:
    from job_executor.identity import IdentityNormalizer, NormalizedIdentity, normalize_group_name, groups_match
    IDENTITY_AVAILABLE = True
except ImportError:
    IDENTITY_AVAILABLE = False

logger = logging.getLogger(__name__)


class FreeIPAAuthenticator:
    """
    Authenticates users against FreeIPA LDAP server.
    
    This class handles LDAP bind operations to authenticate users,
    extract user attributes, and retrieve group memberships from FreeIPA.
    
    Supports both native FreeIPA users and AD Trust users from trusted
    Active Directory domains.
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
        trusted_domains: Optional[List[str]] = None,
        ad_dc_host: Optional[str] = None,
        ad_dc_port: int = 636,
        ad_dc_use_ssl: bool = True,
        ad_domain_fqdn: Optional[str] = None,
    ):
        """
        Initialize FreeIPA authenticator.
        
        Args:
            server_host: FreeIPA server hostname or IP
            base_dn: LDAP base DN (e.g., 'dc=idm,dc=example,dc=com')
            user_search_base: User search base relative to base_dn
            group_search_base: Group search base relative to base_dn
            use_ldaps: Use LDAPS (TLS) connection
            ldaps_port: LDAPS port (default 636)
            ldap_port: LDAP port (default 389)
            verify_certificate: Verify TLS certificate
            ca_certificate: Path to CA certificate file for validation
            connection_timeout: Connection timeout in seconds
            trusted_domains: List of trusted AD domain names (e.g., ['neopost.ad', 'corp.local'])
            ad_dc_host: Active Directory Domain Controller hostname for pass-through auth
            ad_dc_port: AD DC port (default 636 for LDAPS, 389 for LDAP)
            ad_dc_use_ssl: Use LDAPS for AD DC connection (default True)
            ad_domain_fqdn: Explicit AD domain FQDN for when NETBIOS differs from domain name
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
        self.trusted_domains = [d.lower() for d in (trusted_domains or [])]
        self.ad_dc_host = ad_dc_host
        self.ad_dc_port = ad_dc_port
        self.ad_dc_use_ssl = ad_dc_use_ssl
        self.ad_domain_fqdn = ad_domain_fqdn.lower() if ad_domain_fqdn else None
        
        # Derive IPA realm from base_dn (dc=idm,dc=neopost,dc=grp -> idm.neopost.grp)
        self.ipa_realm = self._base_dn_to_realm(base_dn)
        
        self._server = None
        self._ad_server = None
        
        # Initialize identity normalizer for canonical identity handling
        if IDENTITY_AVAILABLE:
            ipa_realm_upper = self._derive_realm_from_base_dn(base_dn)
            self.identity_normalizer = IdentityNormalizer(
                ipa_realm=ipa_realm_upper,
                ipa_domain=self.ipa_realm,
                trusted_domains=self.trusted_domains,
            )
        else:
            self.identity_normalizer = None
    
    def _base_dn_to_realm(self, base_dn: str) -> str:
        """Convert base DN to realm/domain format."""
        # dc=idm,dc=neopost,dc=grp -> idm.neopost.grp
        parts = []
        for part in base_dn.split(','):
            part = part.strip()
            if part.lower().startswith('dc='):
                parts.append(part[3:])
        return '.'.join(parts).lower()
    
    def _derive_realm_from_base_dn(self, base_dn: str) -> str:
        """Derive Kerberos realm from LDAP base DN."""
        # Parse dc=idm,dc=neopost,dc=grp -> IDM.NEOPOST.GRP
        parts = []
        for component in base_dn.split(','):
            component = component.strip()
            if component.lower().startswith('dc='):
                parts.append(component[3:].upper())
        return '.'.join(parts) if parts else 'LOCALDOMAIN'
    
    def normalize_identity(self, username: str) -> Optional[NormalizedIdentity]:
        """
        Normalize a username to canonical form.
        
        Args:
            username: Username in any format (bare, UPN, NT-style)
            
        Returns:
            NormalizedIdentity with canonical principal, realm, etc.
            Returns None if identity normalization is not available.
        """
        if not IDENTITY_AVAILABLE or not self.identity_normalizer:
            logger.warning("Identity normalization not available")
            return None
        return self.identity_normalizer.normalize(username)
    
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
    
    def _get_ad_server(self) -> Optional[Server]:
        """Get or create AD Domain Controller server connection."""
        if not self.ad_dc_host:
            return None

        if self._ad_server is None:
            tls_config = None
            if self.ad_dc_use_ssl:
                tls_config = Tls(
                    validate=ssl.CERT_NONE,  # AD DCs often have self-signed certs
                )
            
            logger.info(f"Creating AD DC server connection: {self.ad_dc_host}:{self.ad_dc_port}, SSL={self.ad_dc_use_ssl}")
            
            self._ad_server = Server(
                self.ad_dc_host,
                port=self.ad_dc_port,
                use_ssl=self.ad_dc_use_ssl,
                tls=tls_config,
                get_info=ALL,
                connect_timeout=self.connection_timeout,
            )
        return self._ad_server

    def _build_ad_search_base(self) -> Optional[str]:
        """Build a DC= search base for AD queries using the configured domain."""
        domain = self.ad_domain_fqdn
        if not domain and self.trusted_domains:
            # Fallback to first trusted domain if explicit domain not set
            domain = self.trusted_domains[0]

        if not domain:
            return None

        labels = [label.strip() for label in domain.split('.') if label.strip()]
        if not labels:
            return None

        return ','.join([f"dc={label}" for label in labels])
    
    def _build_user_dn(self, username: str) -> str:
        """Build user DN from username for native FreeIPA users."""
        # Strip domain if accidentally included
        clean_username = username.split('@')[0] if '@' in username else username
        return f"uid={clean_username},{self.user_search_base},{self.base_dn}"
    
    def _is_ad_trust_user(self, username: str) -> Tuple[bool, str, str]:
        """
        Check if username is from a trusted AD domain.
        
        AD Trust users authenticate with their UPN (user@AD.DOMAIN) or NT-style
        (DOMAIN\\user) format and appear in the cn=users,cn=compat tree rather 
        than cn=users,cn=accounts.
        
        Supports two formats:
        - UPN: user@domain.com
        - NT-style: DOMAIN\\user
        
        Args:
            username: Username to check (may include @domain or DOMAIN\\)
            
        Returns:
            Tuple of (is_ad_trust_user, clean_username, domain)
        """
        # Check NT-style format first: DOMAIN\user
        if '\\' in username:
            parts = username.split('\\', 1)
            if len(parts) == 2:
                domain, user = parts
                domain_lower = domain.lower()
                logger.info(f"NT-style username detected: {domain}\\{user}")
                
                # Check if domain matches any trusted domain (by prefix)
                for trusted in self.trusted_domains:
                    # Match NEOPOSTAD against neopost.ad
                    trusted_prefix = trusted.split('.')[0].lower()
                    if domain_lower == trusted_prefix or domain_lower == trusted:
                        logger.info(f"NT-style user {username} matches trusted domain: {trusted}")
                        return (True, user, trusted)
                
                # If no trusted_domains configured, assume AD trust
                if not self.trusted_domains:
                    logger.info(f"NT-style user {username} assumed to be AD trust user (no trusted_domains configured)")
                    return (True, user, domain)
                
                # Has backslash but domain not recognized
                logger.warning(f"NT-style user {username} domain {domain} not in trusted domains")
                return (True, user, domain)  # Still treat as AD trust user
        
        # Check UPN format: user@domain
        if '@' in username:
            user, domain = username.rsplit('@', 1)
            domain_lower = domain.lower()
            
            # If domain matches IPA realm, it's a native FreeIPA user
            if domain_lower == self.ipa_realm:
                logger.info(f"User {username} domain matches IPA realm, treating as native user")
                return (False, user, domain)
            
            # Check if domain is in explicitly configured trusted domains
            if self.trusted_domains:
                if domain_lower in self.trusted_domains:
                    logger.info(f"User {username} is from trusted AD domain: {domain}")
                    return (True, user, domain)
            
            # If no trusted_domains configured but has @ and doesn't match IPA realm,
            # assume it's an AD trust user (permissive mode)
            if not self.trusted_domains:
                logger.info(f"User {username} has domain suffix different from IPA realm, assuming AD trust user")
                return (True, user, domain)
            
            # Domain not in trusted list
            logger.warning(f"User {username} domain {domain} not in trusted domains list")
            return (False, user, domain)
        
        # Plain username - native FreeIPA user
        return (False, username, '')
    
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
    
    def _authenticate_via_ad_dc(
        self,
        username: str,
        password: str,
        domain: str,
        clean_username: Optional[str] = None,
    ) -> Dict:
        """
        Authenticate AD Trust user directly against the AD Domain Controller.
        
        This is the pass-through method that bypasses FreeIPA for authentication
        but still uses FreeIPA for group membership lookup.
        
        Args:
            username: Full username with domain (user@domain)
            password: User's password
            domain: AD domain name
            clean_username: Optional username without domain/NETBIOS prefix for lookups
            
        Returns:
            Dict with success, user_dn, user_info, error, response_time_ms
        """
        start_time = datetime.now()
        
        ad_server = self._get_ad_server()
        if not ad_server:
            return {
                "success": False,
                "error": "AD Domain Controller not configured (ad_dc_host)",
                "error_details": "Configure AD DC host in IDM settings for AD Trust authentication",
                "response_time_ms": 0,
            }
        
        logger.info(f"Attempting AD DC pass-through authentication for {username} via {self.ad_dc_host}")
        
        try:
            # Bind to AD DC with user's credentials
            # AD accepts UPN format (user@domain) or DOMAIN\user
            conn = Connection(
                ad_server,
                user=username,
                password=password,
                auto_bind=True,
                raise_exceptions=True,
            )
            
            logger.info(f"AD DC bind successful for {username}")
            
            # Try to get user attributes from AD
            user_info = {
                "uid": username,
                "full_name": None,
                "email": None,
            }
            
            # Search for user in AD to get attributes
            # Use ad_domain_fqdn if configured, otherwise derive from domain parameter
            # This handles NETBIOS-to-FQDN mapping (e.g., NEOPOSTAD -> neopost.ad)
            effective_domain = self.ad_domain_fqdn or domain
            ad_base_dn = ','.join([f"dc={p}" for p in effective_domain.split('.')])
            if clean_username:
                user_part = clean_username
            else:
                # Fallback parsing to handle both user@domain and DOMAIN\user
                if '@' in username:
                    user_part = username.split('@', 1)[0]
                elif '\\' in username:
                    user_part = username.split('\\', 1)[1]
                else:
                    user_part = username
            
            logger.info(f"Using AD search base: {ad_base_dn} (domain={domain}, ad_domain_fqdn={self.ad_domain_fqdn})")
            
            try:
                conn.search(
                    search_base=ad_base_dn,
                    search_filter=f"(sAMAccountName={user_part})",
                    search_scope=SUBTREE,
                    attributes=['cn', 'mail', 'displayName', 'memberOf', 'distinguishedName', 'objectSid'],
                )
                
                if conn.entries:
                    entry = conn.entries[0]
                    user_info["full_name"] = str(entry.displayName) if hasattr(entry, 'displayName') else str(entry.cn) if hasattr(entry, 'cn') else None
                    user_info["email"] = str(entry.mail) if hasattr(entry, 'mail') else None
                    user_info["ad_dn"] = str(entry.distinguishedName) if hasattr(entry, 'distinguishedName') else None
                    
                    # Extract and convert user SID
                    if hasattr(entry, 'objectSid') and entry.objectSid.value:
                        sid_binary = entry.objectSid.value
                        user_info["sid"] = self._convert_sid_to_string(sid_binary)
                        logger.info(f"Retrieved AD user SID: {user_info['sid']}")
                    
                    # Capture AD group memberships (DNs) - CRITICAL for nested group resolution
                    # Users are members of AD groups, which in turn are external members of IPA groups
                    if hasattr(entry, 'memberOf') and entry.memberOf.values:
                        ad_group_dns = [str(g) for g in entry.memberOf.values]
                        user_info["ad_groups"] = ad_group_dns
                        logger.info(f"Retrieved {len(ad_group_dns)} AD group membership(s)")
                        for g in ad_group_dns[:5]:  # Log first 5
                            logger.debug(f"  AD group: {g}")
                    
                    logger.info(f"Retrieved AD user attributes for {username}")
            except Exception as e:
                logger.warning(f"Could not retrieve AD user attributes: {e}")
            
            conn.unbind()
            
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            return {
                "success": True,
                "user_dn": f"ad_trust:{username}",
                "user_info": user_info,
                "ad_authenticated": True,
                "response_time_ms": elapsed_ms,
            }
            
        except LDAPBindError as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            logger.error(f"AD DC bind failed for {username}: {e}")
            return {
                "success": False,
                "error": "Invalid credentials",
                "error_details": f"AD DC authentication failed: {str(e)}",
                "response_time_ms": elapsed_ms,
            }
        except LDAPException as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            logger.error(f"AD DC LDAP error for {username}: {e}")
            return {
                "success": False,
                "error": f"LDAP error: {str(e)}",
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

        Supports both native FreeIPA users and AD Trust users:
        - Native users: Bind with constructed DN (uid=user,cn=users,cn=accounts,dc=...)
        - AD Trust users with ad_dc_host: Pass-through to AD DC, then lookup groups in FreeIPA
        - AD Trust users without ad_dc_host: Attempt FreeIPA compat tree bind
        
        Args:
            username: Username (uid) to authenticate - may include @domain for AD users
            password: User's password
            service_bind_dn: Optional service account DN (unused in direct bind)
            service_bind_password: Optional service account password (unused)
            
        Returns:
            Dict with:
            - success: bool
            - user_dn: str (if successful)
            - user_info: dict with uid, full_name, email, title, department
            - groups: list of group DNs
            - is_ad_trust_user: bool
            - error: str (if failed)
            - response_time_ms: int
        """
        start_time = datetime.now()

        try:
            # Check if this is an AD trust user
            is_ad_user, clean_username, domain = self._is_ad_trust_user(username)

            # AD Trust user with AD DC configured: Use AD DC pass-through (preferred)
            if is_ad_user and self.ad_dc_host:
                logger.info(f"Using AD DC pass-through for {username}")
                ad_result = self._authenticate_via_ad_dc(
                    username=username,
                    password=password,
                    domain=domain,
                    clean_username=clean_username,
                )

                if not ad_result.get('success'):
                    return ad_result

                groups: List[str] = []
                user_sid = ad_result.get('user_info', {}).get('sid')
                ad_groups = ad_result.get('user_info', {}).get('ad_groups', [])
                if service_bind_dn and service_bind_password:
                    try:
                        groups = self._lookup_ad_trust_groups_via_service_account(
                            username,
                            service_bind_dn,
                            service_bind_password,
                            user_sid=user_sid,
                            ad_groups=ad_groups,
                        )
                    except Exception as e:
                        logger.warning(f"Error looking up AD trust groups via service account: {e}")

                elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)

                return {
                    "success": True,
                    "user_dn": ad_result.get('user_dn'),
                    "user_info": ad_result.get('user_info', {}),
                    "user_attributes": ad_result.get('user_info', {}),
                    "groups": groups,
                    "is_ad_trust_user": True,
                    "ad_domain": domain,
                    "auth_method": "ad_dc_passthrough",
                    "response_time_ms": ad_result.get('response_time_ms', elapsed_ms),
                }

            # Log if AD trust user but no AD DC configured - will attempt compat tree fallback
            if is_ad_user and not self.ad_dc_host:
                logger.info(f"AD Trust user {username} - no ad_dc_host configured, attempting compat tree fallback")

            # Standard authentication (native FreeIPA or AD trust via compat tree)
            server = self._get_server()

            if is_ad_user:
                # AD Trust users without AD DC configured: try compat tree bind
                bind_user = username  # Keep full user@domain for SASL/Kerberos
                user_search_base = f"cn=users,cn=compat,{self.base_dn}"
                # Match multiple username forms to be resilient
                search_terms = [f"(uid={username})"]
                if clean_username:
                    search_terms.append(f"(uid={clean_username})")
                if domain:
                    search_terms.append(f"(uid={clean_username}@{domain})")
                user_filter = f"(|{''.join(search_terms)})" if len(search_terms) > 1 else search_terms[0]
                logger.info(f"AD Trust authentication for {username} - attempting compat tree bind")
            else:
                # Native FreeIPA users: use DN bind
                bind_user = self._build_user_dn(clean_username)
                user_search_base = f"{self.user_search_base},{self.base_dn}"
                user_filter = f"(uid={clean_username})"
                logger.info(f"Native FreeIPA authentication for {clean_username}")

            logger.debug(f"Bind user: {bind_user}")
            logger.debug(f"Search base: {user_search_base}")
            logger.debug(f"User filter: {user_filter}")

            # Attempt direct bind with user credentials
            conn = Connection(
                server,
                user=bind_user,
                password=password,
                auto_bind=True,
                raise_exceptions=True,
            )

            logger.info(f"LDAP bind successful for {username}")

            # Fetch user attributes from appropriate tree
            user_attrs = [
                "uid", "cn", "sn", "givenName", "mail",
                "memberOf", "title", "departmentNumber",
                # Additional attributes for AD trust users in compat tree
                "gecos", "uidNumber", "gidNumber"
            ]

            conn.search(
                search_base=user_search_base,
                search_filter=user_filter,
                search_scope=SUBTREE,
                attributes=user_attrs,
            )

            user_info: Dict = {}
            groups: List[str] = []
            actual_user_dn = bind_user

            if conn.entries:
                user_entry = conn.entries[0]
                actual_user_dn = str(user_entry.entry_dn)

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

                # For AD trust users, try gecos if cn is missing
                if is_ad_user and not user_info["full_name"] and hasattr(user_entry, 'gecos'):
                    user_info["full_name"] = str(user_entry.gecos)

                # Extract groups
                if hasattr(user_entry, 'memberOf'):
                    groups = [str(g) for g in user_entry.memberOf]

                logger.info(f"Found user entry with {len(groups)} group(s)")
            else:
                # User authenticated but not found in search - this can happen
                # Create basic user info from username
                logger.warning(f"User {username} authenticated but not found in search tree")
                user_info = {
                    "uid": username,
                    "full_name": clean_username,
                    "email": None,
                }

            # For AD trust users, also search for groups in compat groups tree
            if is_ad_user:
                if not groups:
                    groups = self._search_ad_trust_groups(conn, username)
                # Avoid duplicates while preserving order
                if clean_username and clean_username != username and groups:
                    compat_extra = self._search_ad_trust_groups(conn, clean_username)
                    for g in compat_extra:
                        if g not in groups:
                            groups.append(g)

            conn.unbind()

            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)

            return {
                "success": True,
                "user_dn": actual_user_dn,
                "user_info": user_info,
                "user_attributes": user_info,
                "groups": groups,
                "is_ad_trust_user": is_ad_user,
                "ad_domain": domain if is_ad_user else None,
                "auth_method": "freeipa_compat" if is_ad_user else "freeipa_native",
                "response_time_ms": elapsed_ms,
            }
            
        except LDAPBindError as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            logger.error(f"LDAP bind failed for {username}: {e}")
            return {
                "success": False,
                "error": "Invalid credentials",
                "error_details": str(e),
                "response_time_ms": elapsed_ms,
            }
        except LDAPException as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            logger.error(f"LDAP error for {username}: {e}")
            return {
                "success": False,
                "error": f"LDAP error: {str(e)}",
                "error_type": type(e).__name__,
                "response_time_ms": elapsed_ms,
            }
        except Exception as e:
            elapsed_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            logger.error(f"Unexpected error authenticating {username}: {e}")
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}",
                "error_type": type(e).__name__,
                "response_time_ms": elapsed_ms,
            }
    
    def _convert_sid_to_string(self, sid_binary: bytes) -> Optional[str]:
        """
        Convert Windows binary SID to string format (S-1-5-21-...).
        
        Windows SIDs are stored as binary data in AD and need to be converted
        to their string representation for LDAP searches in FreeIPA.
        
        Args:
            sid_binary: Binary SID bytes from AD objectSid attribute
            
        Returns:
            String SID (e.g., S-1-5-21-123456789-987654321-111222333-12345) or None
        """
        try:
            if not sid_binary or len(sid_binary) < 8:
                logger.warning(f"[SID] Invalid SID binary: too short ({len(sid_binary) if sid_binary else 0} bytes)")
                return None
            
            revision = sid_binary[0]
            sub_auth_count = sid_binary[1]
            
            # Authority is 6 bytes, big-endian
            authority = int.from_bytes(sid_binary[2:8], 'big')
            
            # Sub-authorities are 4 bytes each, little-endian
            sub_authorities = []
            for i in range(sub_auth_count):
                offset = 8 + i * 4
                if offset + 4 > len(sid_binary):
                    logger.warning(f"[SID] SID binary truncated at sub-authority {i}")
                    break
                sub_auth = int.from_bytes(sid_binary[offset:offset+4], 'little')
                sub_authorities.append(sub_auth)
            
            sid_string = f"S-{revision}-{authority}-{'-'.join(map(str, sub_authorities))}"
            logger.debug(f"[SID] Converted binary SID to string: {sid_string}")
            return sid_string
            
        except Exception as e:
            logger.error(f"[SID] Failed to convert binary SID: {e}")
            return None
    
    def _ldap_escape(self, value: str) -> str:
        """
        Escape special characters for LDAP search filters.
        
        RFC 4515 requires escaping: * ( ) \\ NUL
        """
        escape_chars = {
            '\\': r'\5c',
            '*': r'\2a',
            '(': r'\28',
            ')': r'\29',
            '\x00': r'\00',
        }
        result = value
        for char, escaped in escape_chars.items():
            result = result.replace(char, escaped)
        return result
    
    def _extract_username_variants(self, username: str) -> List[str]:
        """
        Extract all possible username variants for LDAP search.
        
        Given NEOPOSTAD\\adm_jalexander or adm_jalexander@neopost.ad,
        returns list of variants to search.
        """
        variants = set()
        
        # Add original username
        variants.add(username)
        variants.add(username.lower())
        
        # Extract clean username from NT-style (DOMAIN\\user)
        if '\\' in username:
            parts = username.split('\\')
            if len(parts) == 2:
                domain, clean = parts
                variants.add(clean)
                variants.add(clean.lower())
                # Also try domain\\user format with lowercase
                variants.add(f"{domain.lower()}\\{clean.lower()}")
                
        # Extract clean username from UPN (user@domain)
        if '@' in username:
            parts = username.split('@')
            if len(parts) == 2:
                clean, domain = parts
                variants.add(clean)
                variants.add(clean.lower())
        
        # Also check for AD trust user format
        is_ad_user, clean_username, domain = self._is_ad_trust_user(username)
        if is_ad_user and clean_username:
            variants.add(clean_username)
            variants.add(clean_username.lower())
            if domain:
                # Try UPN format
                variants.add(f"{clean_username}@{domain}")
                variants.add(f"{clean_username.lower()}@{domain.lower()}")
        
        return list(variants)
    
    def _search_ipa_groups_for_external_member(
        self,
        conn: 'Connection',
        username: str,
        user_sid: Optional[str] = None,
        ad_group_sids: Optional[List[str]] = None,
    ) -> List[str]:
        """
        Search IPA groups (cn=groups,cn=accounts) for external AD Trust members.
        
        AD Trust users are added to IPA groups as 'external members' which stores
        their SID in the ipaExternalMember attribute. This method searches for groups
        containing the user's SID OR their AD group SIDs (for nested membership).
        
        IMPORTANT: FreeIPA external membership often works via AD GROUPS, not users directly.
        For example: AD group "cdo infra systems admins" (with its own SID) is added as an
        external member of IPA group "allow_cdo_all_ext". Users who are members of that
        AD group inherit the IPA group membership, but we need to search by the AD GROUP's SID.
        
        Args:
            conn: Active LDAP connection (bound with service account)
            username: Full username with domain (user@domain or DOMAIN\\user)
            user_sid: User's Windows SID (e.g., S-1-5-21-...) - for direct membership
            ad_group_sids: List of SIDs for AD groups the user is a member of - for nested membership
            
        Returns:
            List of group DNs from IPA groups tree
        """
        groups = set()
        
        try:
            # IPA groups are in cn=groups,cn=accounts,dc=...
            ipa_groups_base = f"{self.group_search_base},{self.base_dn}"
            logger.info(f"[IPA GROUP SEARCH] Searching IPA groups in: {ipa_groups_base}")
            
            # Get username variants
            is_ad_user, clean_username, domain = self._is_ad_trust_user(username)
            username_variants = self._extract_username_variants(username)
            
            logger.info(f"[IPA GROUP SEARCH] User SID: {user_sid or 'NOT PROVIDED'}")
            logger.info(f"[IPA GROUP SEARCH] AD Group SIDs: {len(ad_group_sids) if ad_group_sids else 0} provided")
            logger.info(f"[IPA GROUP SEARCH] Username variants: {username_variants[:5]}")
            
            # Strategy 0a (PRIMARY): Search by AD GROUP SIDs
            # This handles the common case where AD groups (not individual users) are
            # added as external members to IPA groups
            if ad_group_sids:
                logger.info(f"[IPA GROUP SEARCH] === Searching by {len(ad_group_sids)} AD GROUP SID(s) ===")
                for group_sid in ad_group_sids:
                    try:
                        logger.debug(f"[IPA GROUP SEARCH] Searching for AD group SID: {group_sid}")
                        conn.search(
                            search_base=ipa_groups_base,
                            search_filter=f"(ipaExternalMember={group_sid})",
                            search_scope=SUBTREE,
                            attributes=["cn", "dn", "ipaExternalMember"],
                        )
                        for entry in conn.entries:
                            group_dn = str(entry.entry_dn)
                            group_cn = entry.cn.value if hasattr(entry, 'cn') else group_dn
                            if group_dn not in groups:
                                groups.add(group_dn)
                                logger.info(f"[IPA GROUP SEARCH] *** FOUND GROUP VIA AD GROUP SID: {group_cn} ({group_dn})")
                    except Exception as e:
                        logger.warning(f"[IPA GROUP SEARCH] AD group SID search failed for {group_sid}: {e}")
            
            # Strategy 0b: Search by user's direct SID (less common but still valid)
            if user_sid:
                logger.info(f"[IPA GROUP SEARCH] Searching by user SID: {user_sid}")
                try:
                    conn.search(
                        search_base=ipa_groups_base,
                        search_filter=f"(ipaExternalMember={user_sid})",
                        search_scope=SUBTREE,
                        attributes=["cn", "dn", "ipaExternalMember"],
                    )
                    for entry in conn.entries:
                        group_dn = str(entry.entry_dn)
                        group_cn = entry.cn.value if hasattr(entry, 'cn') else group_dn
                        if group_dn not in groups:
                            groups.add(group_dn)
                            logger.info(f"[IPA GROUP SEARCH] *** FOUND GROUP VIA USER SID: {group_cn} ({group_dn})")
                except Exception as e:
                    logger.warning(f"[IPA GROUP SEARCH] User SID search failed: {e}")
            else:
                logger.warning(f"[IPA GROUP SEARCH] No user SID provided - user SID search skipped")
            
            # Strategy 1: Search for member attribute containing user's compat DN
            # AD trust users appear in cn=users,cn=compat tree
            compat_user_dns = []
            for variant in username_variants:
                # Build potential compat user DN
                compat_dn = f"uid={variant},cn=users,cn=compat,{self.base_dn}"
                compat_user_dns.append(compat_dn)
            
            for compat_dn in compat_user_dns[:3]:  # Limit to avoid too many queries
                escaped_dn = self._ldap_escape(compat_dn)
                try:
                    conn.search(
                        search_base=ipa_groups_base,
                        search_filter=f"(member={escaped_dn})",
                        search_scope=SUBTREE,
                        attributes=["cn", "dn"],
                    )
                    for entry in conn.entries:
                        group_dn = str(entry.entry_dn)
                        if group_dn not in groups:
                            groups.add(group_dn)
                            logger.info(f"[IPA GROUP SEARCH] Found group via member DN: {group_dn}")
                except Exception as e:
                    logger.debug(f"[IPA GROUP SEARCH] Search with DN {compat_dn[:50]}... failed: {e}")
            
            # Strategy 2: Search for ipaExternalMember containing username (fallback)
            # External members may be stored with SID or other formats
            for variant in username_variants[:3]:
                escaped = self._ldap_escape(variant)
                try:
                    conn.search(
                        search_base=ipa_groups_base,
                        search_filter=f"(ipaExternalMember=*{escaped}*)",
                        search_scope=SUBTREE,
                        attributes=["cn", "dn", "ipaExternalMember"],
                    )
                    for entry in conn.entries:
                        group_dn = str(entry.entry_dn)
                        if group_dn not in groups:
                            groups.add(group_dn)
                            logger.info(f"[IPA GROUP SEARCH] Found group via ipaExternalMember: {group_dn}")
                except Exception as e:
                    logger.debug(f"[IPA GROUP SEARCH] Search with ipaExternalMember={escaped} failed: {e}")
            
            # Strategy 3: Check memberOf on compat user entry
            compat_user_base = f"cn=users,cn=compat,{self.base_dn}"
            for variant in username_variants[:3]:
                escaped = self._ldap_escape(variant)
                try:
                    conn.search(
                        search_base=compat_user_base,
                        search_filter=f"(uid={escaped})",
                        search_scope=SUBTREE,
                        attributes=["memberOf"],
                    )
                    if conn.entries:
                        user_entry = conn.entries[0]
                        if hasattr(user_entry, 'memberOf') and user_entry.memberOf:
                            for group_dn in user_entry.memberOf.values:
                                group_dn_str = str(group_dn)
                                if group_dn_str not in groups:
                                    groups.add(group_dn_str)
                                    logger.info(f"[IPA GROUP SEARCH] Found group via compat user memberOf: {group_dn_str}")
                except Exception as e:
                    logger.debug(f"[IPA GROUP SEARCH] memberOf lookup for {escaped} failed: {e}")
            
            logger.info(f"[IPA GROUP SEARCH] Found {len(groups)} IPA group(s) for AD trust user")
            
        except Exception as e:
            logger.error(f"[IPA GROUP SEARCH] Error searching IPA groups for {username}: {e}")
            import traceback
            logger.debug(f"[IPA GROUP SEARCH] Traceback: {traceback.format_exc()}")
        
        return list(groups)
    
    def _resolve_nested_groups(
        self,
        conn: 'Connection',
        groups: List[str],
        max_depth: int = 3,
    ) -> List[str]:
        """
        Find parent groups that contain the given groups as members.
        
        This handles nested group membership (group-in-group) where:
        - allow_cdo_all_ext is a member of allow_cdo_all
        - User is in allow_cdo_all_ext, so also effectively in allow_cdo_all
        
        Args:
            conn: Active LDAP connection
            groups: List of group DNs to find parents for
            max_depth: Maximum nesting depth to traverse (default 3)
            
        Returns:
            List of parent group DNs
        """
        nested = set()
        to_check = set(groups)
        checked = set()
        depth = 0
        
        try:
            # Search in both IPA groups and compat groups
            search_bases = [
                f"{self.group_search_base},{self.base_dn}",  # cn=groups,cn=accounts
                f"cn=groups,cn=compat,{self.base_dn}",  # cn=groups,cn=compat
            ]
            
            while to_check and depth < max_depth:
                depth += 1
                current_batch = list(to_check - checked)
                to_check = set()
                
                logger.debug(f"[NESTED GROUPS] Depth {depth}: checking {len(current_batch)} group(s)")
                
                for group_dn in current_batch:
                    checked.add(group_dn)
                    escaped_dn = self._ldap_escape(group_dn)
                    
                    for search_base in search_bases:
                        try:
                            # Search for groups where this group is a member
                            conn.search(
                                search_base=search_base,
                                search_filter=f"(member={escaped_dn})",
                                search_scope=SUBTREE,
                                attributes=["dn", "cn"],
                            )
                            
                            for entry in conn.entries:
                                parent_dn = str(entry.entry_dn)
                                if parent_dn not in nested and parent_dn not in checked:
                                    nested.add(parent_dn)
                                    to_check.add(parent_dn)  # Check this parent for further nesting
                                    cn = entry.cn.value if hasattr(entry, 'cn') else parent_dn
                                    logger.info(f"[NESTED GROUPS] Found parent group: {cn}")
                        except Exception as e:
                            logger.debug(f"[NESTED GROUPS] Search in {search_base} failed: {e}")
            
            if nested:
                logger.info(f"[NESTED GROUPS] Found {len(nested)} parent group(s) via nesting")
            
        except Exception as e:
            logger.error(f"[NESTED GROUPS] Error resolving nested groups: {e}")
        
        return list(nested)
    
    def _get_ad_group_sids(
        self,
        ad_group_dns: List[str],
        ad_bind_dn: str,
        ad_bind_password: str,
    ) -> List[str]:
        """
        Get the objectSid for each AD group the user is a member of.
        
        These SIDs are what FreeIPA stores in ipaExternalMember for AD trust groups.
        When an AD GROUP is added as an external member of an IPA group, the AD group's
        SID is stored - not the individual user SIDs.
        
        Args:
            ad_group_dns: List of AD group distinguished names from user's memberOf
            ad_bind_dn: Service account DN for AD DC
            ad_bind_password: Service account password for AD DC
            
        Returns:
            List of SID strings for the AD groups
        """
        group_sids = []
        
        if not ad_group_dns:
            return group_sids
        
        if not self.ad_dc_host:
            logger.warning("[AD GROUP SID] No AD DC configured, cannot retrieve AD group SIDs")
            return group_sids
        
        logger.info(f"[AD GROUP SID] Retrieving SIDs for {len(ad_group_dns)} AD group(s)")
        
        try:
            ad_server = self._get_ad_server()
            
            # Use the service account to query AD for group SIDs
            conn = Connection(
                ad_server,
                user=ad_bind_dn,
                password=ad_bind_password,
                auto_bind=True,
            )
            
            for group_dn in ad_group_dns:
                try:
                    # Search for this specific group DN to get its objectSid
                    conn.search(
                        search_base=group_dn,
                        search_filter="(objectClass=group)",
                        search_scope=BASE,  # Search this exact DN only
                        attributes=['objectSid', 'cn', 'sAMAccountName'],
                    )
                    
                    if conn.entries:
                        entry = conn.entries[0]
                        if hasattr(entry, 'objectSid') and entry.objectSid.value:
                            sid = self._convert_sid_to_string(entry.objectSid.value)
                            if sid:
                                group_sids.append(sid)
                                group_name = entry.cn.value if hasattr(entry, 'cn') else group_dn
                                logger.info(f"[AD GROUP SID] {group_name}: {sid}")
                except Exception as e:
                    # Extract CN from DN for logging
                    cn_match = group_dn.split(',')[0] if ',' in group_dn else group_dn
                    logger.warning(f"[AD GROUP SID] Failed to get SID for {cn_match}: {e}")
            
            conn.unbind()
            
            logger.info(f"[AD GROUP SID] Retrieved {len(group_sids)} AD group SID(s)")
            
        except Exception as e:
            logger.error(f"[AD GROUP SID] Error connecting to AD DC: {e}")
        
        return group_sids
    
    def _lookup_ad_trust_groups_via_service_account(
        self,
        username: str,
        service_bind_dn: Optional[str],
        service_bind_password: Optional[str],
        user_sid: Optional[str] = None,
        ad_groups: Optional[List[str]] = None,
    ) -> List[str]:
        """
        Look up AD Trust user groups in FreeIPA using service account.
        
        Searches multiple locations for group memberships:
        1. Resolve AD group SIDs (for AD groups the user is a member of)
        2. IPA groups tree using AD group SIDs (most reliable for nested membership)
        3. IPA groups tree using user's SID (for direct membership)
        4. Compat groups tree (cn=groups,cn=compat) - POSIX groups with memberUid
        5. Nested group resolution - Parent groups containing the user's groups
        
        This is used after AD DC pass-through authentication to get group memberships.
        
        Args:
            username: Full username with domain (user@domain)
            service_bind_dn: Service account DN for FreeIPA
            service_bind_password: Service account password for FreeIPA
            user_sid: User's Windows SID from AD (e.g., S-1-5-21-...)
            ad_groups: List of AD group DNs the user is a member of
            
        Returns:
            List of group DNs (both direct and nested memberships)
        """
        all_groups = []
        
        if not service_bind_dn or not service_bind_password:
            logger.warning("No service account configured for group lookup after AD DC auth")
            return all_groups
        
        logger.info(f"[GROUP LOOKUP] Starting comprehensive FreeIPA group lookup for AD trust user: {username}")
        logger.info(f"[GROUP LOOKUP] User SID: {user_sid or 'NOT PROVIDED'}")
        logger.info(f"[GROUP LOOKUP] AD groups from memberOf: {len(ad_groups) if ad_groups else 0}")
        logger.debug(f"[GROUP LOOKUP] Using service account: {service_bind_dn}")
        
        # Step 0: Get SIDs for the user's AD groups
        # This is CRITICAL - FreeIPA stores AD GROUP SIDs in ipaExternalMember, not user SIDs
        ad_group_sids = []
        if ad_groups and self.ad_dc_host and self.ad_bind_dn and self.ad_bind_password:
            logger.info(f"[GROUP LOOKUP] Resolving SIDs for {len(ad_groups)} AD group(s)...")
            ad_group_sids = self._get_ad_group_sids(
                ad_groups,
                self.ad_bind_dn,
                self.ad_bind_password,
            )
            logger.info(f"[GROUP LOOKUP] Resolved {len(ad_group_sids)} AD group SID(s)")
        elif ad_groups:
            logger.warning("[GROUP LOOKUP] AD groups found but no AD service account configured to retrieve SIDs")
        
        try:
            server = self._get_server()
            logger.debug(f"[GROUP LOOKUP] Connecting to FreeIPA server: {self.server_host}:{self.server_port}")
            
            conn = Connection(
                server,
                user=service_bind_dn,
                password=service_bind_password,
                auto_bind=True,
            )
            
            logger.info(f"[GROUP LOOKUP] Service account bind successful")
            
            # Step 1: Search compat groups tree (existing behavior)
            compat_groups = self._search_ad_trust_groups(conn, username)
            logger.info(f"[GROUP LOOKUP] Found {len(compat_groups)} group(s) in compat tree")
            
            # Step 2: Search IPA groups for external members (with SID if available)
            # Now includes AD group SIDs for nested membership resolution
            ipa_groups = self._search_ipa_groups_for_external_member(
                conn,
                username,
                user_sid=user_sid,
                ad_group_sids=ad_group_sids,
            )
            logger.info(f"[GROUP LOOKUP] Found {len(ipa_groups)} group(s) in IPA groups tree")
            
            # Combine unique groups
            all_groups = list(set(compat_groups + ipa_groups))
            logger.info(f"[GROUP LOOKUP] Total direct groups: {len(all_groups)}")
            
            # Step 3: Resolve nested group memberships
            if all_groups:
                nested_groups = self._resolve_nested_groups(conn, all_groups)
                # Add nested groups that aren't already in the list
                for ng in nested_groups:
                    if ng not in all_groups:
                        all_groups.append(ng)
                logger.info(f"[GROUP LOOKUP] Total groups (including nested): {len(all_groups)}")
            
            conn.unbind()
            
            if all_groups:
                logger.info(f"[GROUP LOOKUP] Final result: {len(all_groups)} group(s) for {username}")
                for g in all_groups:
                    logger.debug(f"[GROUP LOOKUP]   - {g}")
            else:
                logger.warning(f"[GROUP LOOKUP] No groups found for {username} in any FreeIPA tree")
            
        except Exception as e:
            logger.error(f"[GROUP LOOKUP] Error looking up groups for AD trust user {username}: {e}")
            import traceback
            logger.debug(f"[GROUP LOOKUP] Traceback: {traceback.format_exc()}")
        
        return all_groups
    
    def _search_ad_trust_groups(self, conn: 'Connection', username: str) -> List[str]:
        """
        Search for AD trust user groups in the compat groups tree.
        
        AD trust users may have group memberships in cn=groups,cn=compat
        rather than (or in addition to) memberOf attribute.
        
        Searches with multiple username formats to ensure we find all groups.
        
        Args:
            conn: Active LDAP connection
            username: Full username with domain (user@domain)
            
        Returns:
            List of group DNs
        """
        groups = set()  # Use set to avoid duplicates
        
        try:
            compat_groups_base = f"cn=groups,cn=compat,{self.base_dn}"
            logger.info(f"[GROUP SEARCH] Searching in: {compat_groups_base}")
            
            # Get all username variants to search
            username_variants = self._extract_username_variants(username)
            logger.info(f"[GROUP SEARCH] Will search with {len(username_variants)} username variants:")
            for variant in username_variants:
                logger.debug(f"[GROUP SEARCH]   - '{variant}'")
            
            # Search for each username variant
            for variant in username_variants:
                escaped_variant = self._ldap_escape(variant)
                group_filter = f"(memberUid={escaped_variant})"
                
                logger.debug(f"[GROUP SEARCH] Trying filter: {group_filter}")
                
                conn.search(
                    search_base=compat_groups_base,
                    search_filter=group_filter,
                    search_scope=SUBTREE,
                    attributes=["cn", "dn"],
                )
                
                for entry in conn.entries:
                    group_dn = str(entry.entry_dn)
                    if group_dn not in groups:
                        groups.add(group_dn)
                        logger.info(f"[GROUP SEARCH] Found group with '{variant}': {group_dn}")
            
            if not groups:
                # Try a broader search - look for any memberUid containing the clean username
                is_ad_user, clean_username, domain = self._is_ad_trust_user(username)
                if is_ad_user and clean_username:
                    # Try substring search
                    escaped_clean = self._ldap_escape(clean_username.lower())
                    broad_filter = f"(memberUid=*{escaped_clean}*)"
                    logger.info(f"[GROUP SEARCH] Trying broad substring search: {broad_filter}")
                    
                    conn.search(
                        search_base=compat_groups_base,
                        search_filter=broad_filter,
                        search_scope=SUBTREE,
                        attributes=["cn", "dn", "memberUid"],
                    )
                    
                    for entry in conn.entries:
                        group_dn = str(entry.entry_dn)
                        member_uids = entry.memberUid.values if hasattr(entry, 'memberUid') else []
                        logger.debug(f"[GROUP SEARCH] Broad search found group {group_dn}, memberUids: {list(member_uids)[:5]}...")
                        groups.add(group_dn)
            
            if groups:
                logger.info(f"[GROUP SEARCH] Total: Found {len(groups)} unique group(s) for AD trust user")
            else:
                logger.warning(f"[GROUP SEARCH] No groups found with any username variant")
                # Log what memberUid values exist in some groups for debugging
                logger.debug(f"[GROUP SEARCH] Sampling compat groups to see memberUid format...")
                conn.search(
                    search_base=compat_groups_base,
                    search_filter="(objectClass=posixGroup)",
                    search_scope=SUBTREE,
                    attributes=["cn", "memberUid"],
                    size_limit=3,
                )
                for entry in conn.entries:
                    cn = entry.cn.value if hasattr(entry, 'cn') else 'unknown'
                    member_uids = list(entry.memberUid.values)[:5] if hasattr(entry, 'memberUid') else []
                    logger.debug(f"[GROUP SEARCH] Sample group '{cn}' memberUids: {member_uids}")
                
        except Exception as e:
            logger.error(f"[GROUP SEARCH] Error searching compat groups for {username}: {e}")
            import traceback
            logger.debug(f"[GROUP SEARCH] Traceback: {traceback.format_exc()}")
        
        return list(groups)
    
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
            
            # Check if AD trust user
            is_ad_user, clean_username, domain = self._is_ad_trust_user(username)
            
            if is_ad_user:
                # Search compat tree for AD trust users
                user_dn = None
                user_search_base = f"cn=users,cn=compat,{self.base_dn}"
                
                conn.search(
                    search_base=user_search_base,
                    search_filter=f"(uid={username})",
                    search_scope=SUBTREE,
                    attributes=["memberOf"],
                )
                
                groups = []
                if conn.entries:
                    user_entry = conn.entries[0]
                    if hasattr(user_entry, 'memberOf'):
                        groups = [str(g) for g in user_entry.memberOf]
                
                # Also check compat groups
                compat_groups = self._search_ad_trust_groups(conn, username)
                groups.extend([g for g in compat_groups if g not in groups])
                
            else:
                # Native FreeIPA user
                user_dn = self._build_user_dn(clean_username)
                
                conn.search(
                    search_base=f"{self.user_search_base},{self.base_dn}",
                    search_filter=f"(uid={clean_username})",
                    search_scope=SUBTREE,
                    attributes=["memberOf"],
                )
                
                groups = []
                if conn.entries:
                    user_entry = conn.entries[0]
                    if hasattr(user_entry, 'memberOf'):
                        groups = [str(g) for g in user_entry.memberOf]
            
            conn.unbind()
            return groups
            
        except Exception as e:
            logger.error(f"Error getting groups for {username}: {e}")
            return []
    
    def _resolve_sid_via_ipa_command(self, sid: str) -> Optional[str]:
        """
        Resolve a SID to username using the FreeIPA 'ipa trust-resolve' command.
        
        This requires the job executor to run on a machine enrolled in FreeIPA
        with valid Kerberos credentials (e.g., from a keytab or kinit).
        
        Args:
            sid: Windows SID (e.g., 'S-1-5-21-3513274823-891799712-3985061265-262796')
            
        Returns:
            Resolved username (e.g., 'NEOPOSTAD:jalexander') or None if failed
        """
        import subprocess
        
        try:
            result = subprocess.run(
                ['ipa', 'trust-resolve', sid],
                capture_output=True,
                text=True,
                timeout=15,
            )
            
            if result.returncode == 0:
                # Parse output - ipa trust-resolve returns the username
                # Output format is typically: "jalexander@neopost.ad" or similar
                output = result.stdout.strip()
                
                if output:
                    # Format as DOMAIN:username for display
                    if '@' in output:
                        # Split user@domain.tld -> DOMAIN:user
                        parts = output.split('@')
                        user_part = parts[0]
                        domain_part = parts[-1].upper().split('.')[0]  # neopost.ad -> NEOPOST
                        return f"{domain_part}:{user_part}"
                    elif '\\' in output:
                        # Already DOMAIN\\user format -> DOMAIN:user
                        parts = output.split('\\')
                        return f"{parts[0].upper()}:{parts[1]}"
                    else:
                        return output
            else:
                # Log stderr for debugging, but don't spam logs
                stderr = result.stderr.strip()
                if stderr and 'not found' not in stderr.lower():
                    logger.debug(f"[SID RESOLVE] ipa trust-resolve stderr: {stderr[:100]}")
                    
        except FileNotFoundError:
            # 'ipa' command not found - job executor not on FreeIPA-enrolled host
            logger.debug("[SID RESOLVE] 'ipa' command not found - not enrolled in FreeIPA?")
        except subprocess.TimeoutExpired:
            logger.warning(f"[SID RESOLVE] ipa trust-resolve timed out for SID {sid[-12:]}...")
        except Exception as e:
            logger.debug(f"[SID RESOLVE] ipa trust-resolve error: {e}")
        
        return None
    
    def _resolve_sids_to_usernames(
        self,
        conn: 'Connection',
        sids: List[str],
        *,
        bind_dn: str,
        bind_password: str,
        ad_bind_dn: Optional[str] = None,
        ad_bind_password: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Resolve Windows SIDs to usernames using multiple strategies.
        
        Strategy order (stops when all SIDs resolved):
        0. ipa trust-resolve command (PREFERRED - most reliable)
        1. ID Views tree (Default Trust View)
        2. Compat users tree with multiple SID attribute names
        3. RID-based pattern matching
        4. AD DC direct query (if configured)
        
        Args:
            conn: Active LDAP connection
            sids: List of SIDs to resolve (e.g., ['S-1-5-21-xxx-262796'])
            
        Returns:
            Dict mapping SID -> username (e.g., {'S-1-5-21-xxx-262796': 'NEOPOSTAD:jalexander'})
        """
        resolved = {}
        if not sids:
            return resolved
        
        logger.info(f"[SID RESOLVE] Attempting to resolve {len(sids)} SID(s)")
        
        # === STRATEGY 0: Use 'ipa trust-resolve' command (PREFERRED) ===
        # This is the most reliable method when running on a FreeIPA-enrolled host
        logger.info("[SID RESOLVE] Strategy 0: Using 'ipa trust-resolve' command")
        
        ipa_available = True
        for sid in sids:
            if not ipa_available:
                break
            username = self._resolve_sid_via_ipa_command(sid)
            if username:
                resolved[sid] = username
                logger.info(f"[SID RESOLVE] Strategy 0 resolved: {sid[-12:]}... -> {username}")
            elif username is None:
                # Check if ipa command exists by looking at first failure
                # If first SID fails due to missing ipa command, skip rest
                import shutil
                if not shutil.which('ipa'):
                    logger.info("[SID RESOLVE] Strategy 0: 'ipa' command not available, falling back to LDAP strategies")
                    ipa_available = False
        
        # If Strategy 0 resolved all SIDs, we're done
        if len(resolved) == len(sids):
            logger.info(f"[SID RESOLVE] All {len(sids)} SIDs resolved via ipa trust-resolve command")
            return resolved
        
        # === FALLBACK: LDAP-based strategies for hosts not enrolled in FreeIPA ===
        unresolved_count = len(sids) - len(resolved)
        if unresolved_count > 0:
            logger.info(f"[SID RESOLVE] {unresolved_count} SID(s) remaining, trying LDAP fallback strategies")
        
        compat_users_base = f"cn=users,cn=compat,{self.base_dn}"
        
        # === STRATEGY 1: Search ID Views tree (Default Trust View) ===
        id_views_base = f"cn=Default Trust View,cn=views,cn=accounts,{self.base_dn}"
        logger.debug(f"[SID RESOLVE] Strategy 1: ID Views tree ({id_views_base})")
        
        for sid in sids:
            if sid in resolved:
                continue
            try:
                escaped_sid = self._ldap_escape(sid)
                # ID Views may store anchor with SID or the raw SID
                sid_filter = f"(|(ipaNTSecurityIdentifier={escaped_sid})(objectSid={escaped_sid})(ipaAnchorUUID=*{escaped_sid}*))"
                
                conn.search(
                    search_base=id_views_base,
                    search_filter=sid_filter,
                    search_scope=SUBTREE,
                    attributes=["uid", "cn", "ipaOriginalUid", "ipaAnchorUUID"],
                )
                
                if conn.entries:
                    entry = conn.entries[0]
                    username = None
                    if hasattr(entry, 'ipaOriginalUid') and entry.ipaOriginalUid.value:
                        username = str(entry.ipaOriginalUid.value)
                    elif hasattr(entry, 'uid') and entry.uid.value:
                        username = str(entry.uid.value)
                    elif hasattr(entry, 'cn') and entry.cn.value:
                        username = str(entry.cn.value)
                    
                    if username:
                        resolved[sid] = username
                        logger.info(f"[SID RESOLVE] Strategy 1 resolved: {sid[-12:]}... -> {username}")
            except Exception as e:
                logger.debug(f"[SID RESOLVE] Strategy 1 failed for {sid[-12:]}: {e}")
        
        # === STRATEGY 2: Search compat users tree with multiple attribute names ===
        logger.debug(f"[SID RESOLVE] Strategy 2: Compat users tree ({compat_users_base})")
        
        for sid in sids:
            if sid in resolved:
                continue
            try:
                escaped_sid = self._ldap_escape(sid)
                # Try multiple possible SID attribute names used by FreeIPA
                sid_filter = f"(|(ipaNTSecurityIdentifier={escaped_sid})(objectSid={escaped_sid})(sambaSID={escaped_sid})(ntSecurityIdentifier={escaped_sid}))"
                
                conn.search(
                    search_base=compat_users_base,
                    search_filter=sid_filter,
                    search_scope=SUBTREE,
                    attributes=["uid", "cn", "gecos", "ipaNTSecurityIdentifier", "objectSid"],
                )
                
                if conn.entries:
                    entry = conn.entries[0]
                    username = None
                    if hasattr(entry, 'uid') and entry.uid.value:
                        username = str(entry.uid.value)
                    elif hasattr(entry, 'cn') and entry.cn.value:
                        username = str(entry.cn.value)
                    elif hasattr(entry, 'gecos') and entry.gecos.value:
                        username = str(entry.gecos.value)
                    
                    if username:
                        resolved[sid] = username
                        logger.info(f"[SID RESOLVE] Strategy 2 resolved: {sid[-12:]}... -> {username}")
                else:
                    logger.debug(f"[SID RESOLVE] Strategy 2: No match for SID {sid[-12:]}...")
            except Exception as e:
                logger.debug(f"[SID RESOLVE] Strategy 2 failed for {sid[-12:]}: {e}")
        
        # === STRATEGY 3: Extract RID and search by pattern matching ===
        # SIDs like S-1-5-21-xxx-xxx-262796 - the last part (RID) may be in uid
        logger.debug(f"[SID RESOLVE] Strategy 3: RID-based pattern matching")
        
        for sid in sids:
            if sid in resolved:
                continue
            try:
                # Extract RID (last component of SID)
                rid = sid.split('-')[-1]
                
                # Search for users with this RID in their uid or related attributes
                # Some systems store users as uid=S-1-5-21-xxx-RID or similar
                rid_filter = f"(|(uid=*{rid}*)(cn=*{rid}*))"
                
                conn.search(
                    search_base=compat_users_base,
                    search_filter=rid_filter,
                    search_scope=SUBTREE,
                    attributes=["uid", "cn", "gecos"],
                    size_limit=10,
                )
                
                # Look for exact RID match
                for entry in conn.entries:
                    entry_uid = str(entry.uid.value) if hasattr(entry, 'uid') and entry.uid.value else ''
                    # Check if this entry's SID ends with our RID
                    if entry_uid and rid in entry_uid:
                        # This might be the user, extract clean username if possible
                        username = entry_uid
                        # If uid looks like domain\\user or S-1-xxx format, try to clean it
                        if '\\' in username:
                            username = username.split('\\')[-1]
                        resolved[sid] = username
                        logger.info(f"[SID RESOLVE] Strategy 3 (RID match) resolved: {sid[-12:]}... -> {username}")
                        break
            except Exception as e:
                logger.debug(f"[SID RESOLVE] Strategy 3 failed for {sid[-12:]}: {e}")
        
        # === STRATEGY 4: Query AD DC directly if available ===
        if self.ad_dc_host:
            unresolved_sids = [s for s in sids if s not in resolved]
            if unresolved_sids:
                logger.info(f"[SID RESOLVE] Strategy 4: Querying AD DC ({self.ad_dc_host}) for {len(unresolved_sids)} SID(s)")
                try:
                    ad_server = self._get_ad_server()
                    if ad_server:
                        ad_search_base = self._build_ad_search_base()
                        if not ad_search_base:
                            logger.warning("[SID RESOLVE] Strategy 4: No AD domain configured for search base; skipping AD lookup")
                            return resolved

                        # AD uses objectSid attribute
                        ad_conn = Connection(
                            ad_server,
                            user=ad_bind_dn or bind_dn,
                            password=ad_bind_password or bind_password,
                            auto_bind=True,
                        )
                        
                        for sid in unresolved_sids:
                            try:
                                escaped_sid = self._ldap_escape(sid)
                                ad_conn.search(
                                    search_base=ad_search_base,
                                    search_filter=f"(objectSid={escaped_sid})",
                                    search_scope=SUBTREE,
                                    attributes=["sAMAccountName", "cn", "userPrincipalName"],
                                )
                                
                                if ad_conn.entries:
                                    entry = ad_conn.entries[0]
                                    username = None
                                    if hasattr(entry, 'sAMAccountName') and entry.sAMAccountName.value:
                                        username = str(entry.sAMAccountName.value)
                                    elif hasattr(entry, 'cn') and entry.cn.value:
                                        username = str(entry.cn.value)
                                    
                                    if username:
                                        resolved[sid] = f"AD:{username}"
                                        logger.info(f"[SID RESOLVE] Strategy 4 (AD DC) resolved: {sid[-12:]}... -> AD:{username}")
                            except Exception as e:
                                logger.debug(f"[SID RESOLVE] Strategy 4 AD query failed for {sid[-12:]}: {e}")
                        
                        ad_conn.unbind()
                except Exception as e:
                    logger.warning(f"[SID RESOLVE] Strategy 4 (AD DC) failed: {e}")
        
        # Log summary
        logger.info(f"[SID RESOLVE] Final result: Resolved {len(resolved)}/{len(sids)} SIDs to usernames")
        for sid, username in resolved.items():
            logger.debug(f"[SID RESOLVE]   {sid[-16:]}... -> {username}")
        
        # Log unresolved SIDs
        unresolved = [s for s in sids if s not in resolved]
        if unresolved:
            logger.warning(f"[SID RESOLVE] Could not resolve {len(unresolved)} SID(s):")
            for sid in unresolved[:5]:  # Log first 5
                logger.warning(f"[SID RESOLVE]   Unresolved: {sid}")
        
        return resolved

    def search_groups(
        self,
        bind_dn: str,
        bind_password: str,
        search_term: str = "",
        max_results: int = 100,
        *,
        ad_bind_dn: Optional[str] = None,
        ad_bind_password: Optional[str] = None,
    ) -> List[Dict]:
        """
        Search for groups in FreeIPA.
        
        Args:
            bind_dn: Service account DN
            bind_password: Service account password
            search_term: Optional search filter (matches cn)
            max_results: Maximum number of results to return
            
        Returns:
            List of group dicts with dn, cn, description, member_count, members
        """
        try:
            server = self._get_server()
            conn = Connection(
                server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
            )
            
            # Build search filter - include all FreeIPA group types
            # groupOfNames, posixGroup, ipaUserGroup, ipaExternalGroup
            group_classes = "(|(objectClass=groupOfNames)(objectClass=posixGroup)(objectClass=ipaUserGroup)(objectClass=ipaExternalGroup))"
            if search_term:
                search_filter = f"(&{group_classes}(cn=*{search_term}*))"
            else:
                search_filter = group_classes
            
            conn.search(
                search_base=f"{self.group_search_base},{self.base_dn}",
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=["cn", "description", "member", "memberUid", "ipaExternalMember"],
                size_limit=max_results,
            )
            
            # First pass: collect all SIDs that need resolution
            all_sids = set()
            entries_data = []  # Store entry data for second pass
            
            for entry in conn.entries:
                entry_info = {
                    'entry': entry,
                    'ext_sids': [],  # SIDs found in ipaExternalMember
                }
                
                if hasattr(entry, 'ipaExternalMember'):
                    ext_values = entry.ipaExternalMember.values if hasattr(entry.ipaExternalMember, 'values') else []
                    if not isinstance(ext_values, (list, tuple)):
                        ext_values = [ext_values] if ext_values else []
                    
                    for ext_member in ext_values:
                        ext_str = str(ext_member)
                        if ext_str.startswith('S-1-'):
                            all_sids.add(ext_str)
                            entry_info['ext_sids'].append(ext_str)
                
                entries_data.append(entry_info)
            
            # Resolve all SIDs in one batch
            sid_to_username = {}
            if all_sids:
                logger.info(f"[GROUP SEARCH] Found {len(all_sids)} unique SIDs to resolve")
                sid_to_username = self._resolve_sids_to_usernames(
                    conn,
                    list(all_sids),
                    bind_dn=bind_dn,
                    bind_password=bind_password,
                    ad_bind_dn=ad_bind_dn,
                    ad_bind_password=ad_bind_password,
                )
            
            # Second pass: build group results with resolved usernames
            groups = []
            for entry_info in entries_data:
                entry = entry_info['entry']
                members = []
                member_count = 0
                
                # 1. Parse 'member' attribute (DNs like uid=john,cn=users,...)
                member_dn_count = 0
                if hasattr(entry, 'member'):
                    member_values = entry.member.values if hasattr(entry.member, 'values') else []
                    if not isinstance(member_values, (list, tuple)):
                        member_values = [member_values] if member_values else []
                    
                    member_dn_count = len(member_values)
                    member_count += member_dn_count
                    
                    for member_dn in member_values[:20]:
                        member_dn_str = str(member_dn)
                        uid_match = re.match(r'uid=([^,]+)', member_dn_str)
                        if uid_match:
                            members.append(uid_match.group(1))
                        else:
                            cn_match = re.match(r'cn=([^,]+)', member_dn_str)
                            if cn_match:
                                members.append(f"[{cn_match.group(1)}]")
                
                # 2. Parse 'memberUid' attribute (POSIX - direct usernames)
                member_uid_count = 0
                if hasattr(entry, 'memberUid'):
                    uid_values = entry.memberUid.values if hasattr(entry.memberUid, 'values') else []
                    if not isinstance(uid_values, (list, tuple)):
                        uid_values = [uid_values] if uid_values else []
                    
                    member_uid_count = len(uid_values)
                    member_count += member_uid_count
                    
                    for uid in uid_values[:20]:
                        uid_str = str(uid)
                        if uid_str not in members:
                            members.append(uid_str)
                
                # 3. Parse 'ipaExternalMember' attribute (AD Trust users - SIDs or DOMAIN\username)
                ext_member_count = 0
                if hasattr(entry, 'ipaExternalMember'):
                    ext_values = entry.ipaExternalMember.values if hasattr(entry.ipaExternalMember, 'values') else []
                    if not isinstance(ext_values, (list, tuple)):
                        ext_values = [ext_values] if ext_values else []
                    
                    ext_member_count = len(ext_values)
                    member_count += ext_member_count
                    
                    for ext_member in ext_values[:20]:
                        ext_str = str(ext_member)
                        if '\\' in ext_str:
                            # DOMAIN\username format - extract username
                            username = ext_str.split('\\')[-1]
                            display = f"AD:{username}"
                        elif ext_str.startswith('S-1-'):
                            # SID format - try to resolve, fallback to abbreviated SID
                            if ext_str in sid_to_username:
                                display = f"AD:{sid_to_username[ext_str]}"
                            else:
                                display = f"SID:...{ext_str[-8:]}"
                        else:
                            display = f"EXT:{ext_str}"
                        
                        if display not in members:
                            members.append(display)
                
                group_cn = str(entry.cn) if hasattr(entry, 'cn') else None
                logger.debug(f"[GROUP SEARCH] Group {group_cn}: {member_count} members "
                           f"(member={member_dn_count}, memberUid={member_uid_count}, ipaExternalMember={ext_member_count})")
                
                groups.append({
                    "dn": str(entry.entry_dn),
                    "cn": group_cn,
                    "description": str(entry.description) if hasattr(entry, 'description') else None,
                    "member_count": member_count,
                    "members": members,
                })
            
            conn.unbind()
            logger.info(f"[GROUP SEARCH] Found {len(groups)} groups matching '{search_term}'")
            return groups
            
        except Exception as e:
            logger.error(f"Error searching groups: {e}")
            return []
    
    def sync_all_users(
        self,
        bind_dn: str,
        bind_password: str,
    ) -> List[Dict]:
        """
        Retrieve all users from FreeIPA for sync purposes.
        
        Args:
            bind_dn: Service account DN
            bind_password: Service account password
            
        Returns:
            List of user dicts with uid, full_name, email, groups, etc.
        """
        try:
            server = self._get_server()
            conn = Connection(
                server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
            )
            
            # Search for all users
            conn.search(
                search_base=f"{self.user_search_base},{self.base_dn}",
                search_filter="(objectClass=person)",
                search_scope=SUBTREE,
                attributes=[
                    "uid", "cn", "sn", "givenName", "mail",
                    "memberOf", "title", "departmentNumber",
                    "nsAccountLock",
                ],
            )
            
            users = []
            for entry in conn.entries:
                user = {
                    "uid": str(entry.uid) if hasattr(entry, 'uid') else None,
                    "dn": str(entry.entry_dn),
                    "full_name": str(entry.cn) if hasattr(entry, 'cn') else None,
                    "first_name": str(entry.givenName) if hasattr(entry, 'givenName') else None,
                    "last_name": str(entry.sn) if hasattr(entry, 'sn') else None,
                    "email": str(entry.mail) if hasattr(entry, 'mail') else None,
                    "title": str(entry.title) if hasattr(entry, 'title') else None,
                    "department": str(entry.departmentNumber) if hasattr(entry, 'departmentNumber') else None,
                    "disabled": str(entry.nsAccountLock).lower() == 'true' if hasattr(entry, 'nsAccountLock') else False,
                    "groups": [str(g) for g in entry.memberOf] if hasattr(entry, 'memberOf') else [],
                }
                if user["uid"]:  # Only include users with uid
                    users.append(user)
            
            conn.unbind()
            logger.info(f"Retrieved {len(users)} users from FreeIPA")
            return users
            
        except Exception as e:
            logger.error(f"Error syncing users: {e}")
            return []
    
    def search_ad_groups(
        self,
        bind_dn: str,
        bind_password: str,
        search_term: str = "",
        max_results: int = 100,
    ) -> List[Dict]:
        """
        Search for groups directly in Active Directory.
        
        This connects to the AD DC directly instead of going through FreeIPA,
        which allows us to get actual usernames instead of SIDs.
        
        Args:
            bind_dn: Service account DN for AD (e.g., 'CN=svc_ldap,OU=Service Accounts,DC=neopost,DC=ad')
            bind_password: Service account password
            search_term: Optional search filter (matches cn/name)
            max_results: Maximum number of results to return
            
        Returns:
            List of group dicts with dn, cn, description, member_count, members (actual usernames)
        """
        if not self.ad_dc_host:
            logger.error("[AD SEARCH] AD DC host not configured")
            return []
        
        try:
            # Build AD DC server connection
            ad_server = self._get_ad_server()
            if not ad_server:
                logger.error("[AD SEARCH] Failed to create AD server connection")
                return []
            
            logger.info(f"[AD SEARCH] Connecting to AD DC {self.ad_dc_host}...")
            
            conn = Connection(
                ad_server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
            )
            
            logger.info("[AD SEARCH] Connected to AD DC successfully")
            
            # Derive AD base DN from domain FQDN
            # e.g., neopost.ad -> DC=neopost,DC=ad
            if self.ad_domain_fqdn:
                ad_base_dn = ','.join([f'DC={part}' for part in self.ad_domain_fqdn.split('.')])
            else:
                # Try to derive from ad_dc_host
                # s06-nad-dc04.neopost.ad -> DC=neopost,DC=ad
                parts = self.ad_dc_host.split('.')
                if len(parts) >= 2:
                    ad_base_dn = ','.join([f'DC={part}' for part in parts[1:]])
                else:
                    ad_base_dn = 'DC=ad'
            
            logger.info(f"[AD SEARCH] Using AD base DN: {ad_base_dn}")
            
            # Build search filter for AD groups
            if search_term:
                search_filter = f"(&(objectClass=group)(cn=*{search_term}*))"
            else:
                search_filter = "(objectClass=group)"
            
            logger.info(f"[AD SEARCH] Searching with filter: {search_filter}")
            
            conn.search(
                search_base=ad_base_dn,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=["cn", "description", "member", "sAMAccountName", "distinguishedName"],
                size_limit=max_results,
            )
            
            groups = []
            for entry in conn.entries:
                members = []
                member_count = 0
                
                # Parse 'member' attribute - AD stores full DNs like CN=John Smith,OU=Users,DC=neopost,DC=ad
                if hasattr(entry, 'member'):
                    member_values = entry.member.values if hasattr(entry.member, 'values') else []
                    if not isinstance(member_values, (list, tuple)):
                        member_values = [member_values] if member_values else []
                    
                    member_count = len(member_values)
                    
                    for member_dn in member_values[:20]:
                        member_dn_str = str(member_dn)
                        # Extract CN (common name) from DN
                        cn_match = re.match(r'CN=([^,]+)', member_dn_str, re.IGNORECASE)
                        if cn_match:
                            members.append(cn_match.group(1))
                
                group_cn = str(entry.cn) if hasattr(entry, 'cn') else None
                sam_account = str(entry.sAMAccountName) if hasattr(entry, 'sAMAccountName') else group_cn
                
                groups.append({
                    "dn": str(entry.entry_dn),
                    "cn": sam_account or group_cn,  # Prefer sAMAccountName for AD groups
                    "description": str(entry.description) if hasattr(entry, 'description') else None,
                    "member_count": member_count,
                    "members": members,
                    "source": "ad",
                })
            
            conn.unbind()
            logger.info(f"[AD SEARCH] Found {len(groups)} AD groups matching '{search_term}'")
            return groups
            
        except LDAPBindError as e:
            logger.error(f"[AD SEARCH] AD bind failed: {e}")
            return []
        except LDAPException as e:
            logger.error(f"[AD SEARCH] AD LDAP error: {e}")
            return []
        except Exception as e:
            logger.error(f"[AD SEARCH] Error searching AD groups: {e}")
            return []
    
    def search_ad_users(
        self,
        bind_dn: str,
        bind_password: str,
        search_term: str = "",
        max_results: int = 50,
    ) -> List[Dict]:
        """
        Search for users directly in Active Directory.
        
        Args:
            bind_dn: Service account DN for binding (can use UPN format like svc@domain.com)
            bind_password: Service account password
            search_term: Optional search term to filter by (searches sAMAccountName, displayName, cn)
            max_results: Maximum number of results to return
            
        Returns:
            List of dicts with user information:
            - sam_account_name: sAMAccountName (username)
            - display_name: Full name
            - email: Email address
            - dn: Distinguished name
            - department: Department
            - title: Job title
        """
        ad_server = self._get_ad_server()
        if not ad_server:
            logger.error("[AD USER SEARCH] AD DC not configured")
            return []
        
        # Derive base DN from AD domain FQDN
        if self.ad_domain_fqdn:
            ad_base_dn = ','.join([f"dc={part}" for part in self.ad_domain_fqdn.split('.')])
        else:
            logger.error("[AD USER SEARCH] AD domain FQDN not configured")
            return []
        
        logger.info(f"[AD USER SEARCH] Searching AD users on {self.ad_dc_host} with base DN: {ad_base_dn}")
        logger.info(f"[AD USER SEARCH] Search term: '{search_term}', max results: {max_results}")
        
        try:
            # Connect with service account
            conn = Connection(
                ad_server,
                user=bind_dn,
                password=bind_password,
                auto_bind=True,
                raise_exceptions=True,
            )
            
            logger.info(f"[AD USER SEARCH] Bound successfully as {bind_dn}")
            
            # Build search filter
            if search_term:
                # Search in sAMAccountName, displayName, cn, mail
                escaped_term = self._ldap_escape(search_term)
                search_filter = f"(&(objectClass=user)(objectCategory=person)(|(sAMAccountName=*{escaped_term}*)(displayName=*{escaped_term}*)(cn=*{escaped_term}*)(mail=*{escaped_term}*)))"
            else:
                # Get all users (limited by max_results)
                search_filter = "(&(objectClass=user)(objectCategory=person))"
            
            logger.info(f"[AD USER SEARCH] Filter: {search_filter}")
            
            conn.search(
                search_base=ad_base_dn,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=[
                    'sAMAccountName', 'displayName', 'cn', 'mail',
                    'department', 'title', 'distinguishedName',
                    'userPrincipalName', 'memberOf'
                ],
                size_limit=max_results,
            )
            
            users = []
            for entry in conn.entries:
                sam = str(entry.sAMAccountName) if hasattr(entry, 'sAMAccountName') else None
                if not sam:
                    continue
                    
                user_info = {
                    "sam_account_name": sam,
                    "display_name": str(entry.displayName) if hasattr(entry, 'displayName') and entry.displayName.value else str(entry.cn) if hasattr(entry, 'cn') else sam,
                    "email": str(entry.mail) if hasattr(entry, 'mail') and entry.mail.value else None,
                    "dn": str(entry.distinguishedName) if hasattr(entry, 'distinguishedName') else None,
                    "department": str(entry.department) if hasattr(entry, 'department') and entry.department.value else None,
                    "title": str(entry.title) if hasattr(entry, 'title') and entry.title.value else None,
                    "upn": str(entry.userPrincipalName) if hasattr(entry, 'userPrincipalName') and entry.userPrincipalName.value else None,
                    "groups": [str(g) for g in entry.memberOf.values] if hasattr(entry, 'memberOf') and entry.memberOf.values else [],
                }
                users.append(user_info)
            
            conn.unbind()
            logger.info(f"[AD USER SEARCH] Found {len(users)} AD users matching '{search_term}'")
            return users
            
        except LDAPBindError as e:
            logger.error(f"[AD USER SEARCH] AD bind failed: {e}")
            return []
        except LDAPException as e:
            logger.error(f"[AD USER SEARCH] AD LDAP error: {e}")
            return []
        except Exception as e:
            logger.error(f"[AD USER SEARCH] Error searching AD users: {e}")
            import traceback
            logger.debug(f"[AD USER SEARCH] Traceback: {traceback.format_exc()}")
            return []
    
    def _get_ad_server(self) -> Optional['Server']:
        """Create or return cached AD DC server connection."""
        if self._ad_server is not None:
            return self._ad_server
        
        if not self.ad_dc_host:
            return None
        
        try:
            tls_config = None
            if self.ad_dc_use_ssl:
                tls_config = Tls(
                    validate=ssl.CERT_NONE,  # AD certs often have issues
                    version=ssl.PROTOCOL_TLSv1_2,
                )
            
            port = self.ad_dc_port
            use_ssl = self.ad_dc_use_ssl
            
            self._ad_server = Server(
                self.ad_dc_host,
                port=port,
                use_ssl=use_ssl,
                tls=tls_config,
                get_info=ALL,
                connect_timeout=self.connection_timeout,
            )
            
            logger.info(f"[AD SERVER] Created AD server: {self.ad_dc_host}:{port} (SSL={use_ssl})")
            return self._ad_server
            
        except Exception as e:
            logger.error(f"[AD SERVER] Failed to create AD server: {e}")
            return None
