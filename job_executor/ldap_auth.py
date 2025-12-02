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
                    attributes=['cn', 'mail', 'displayName', 'memberOf', 'distinguishedName'],
                )
                
                if conn.entries:
                    entry = conn.entries[0]
                    user_info["full_name"] = str(entry.displayName) if hasattr(entry, 'displayName') else str(entry.cn) if hasattr(entry, 'cn') else None
                    user_info["email"] = str(entry.mail) if hasattr(entry, 'mail') else None
                    user_info["ad_dn"] = str(entry.distinguishedName) if hasattr(entry, 'distinguishedName') else None
                    
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
                if service_bind_dn and service_bind_password:
                    try:
                        groups = self._lookup_ad_trust_groups_via_service_account(
                            username,
                            service_bind_dn,
                            service_bind_password,
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
    
    def _lookup_ad_trust_groups_via_service_account(
        self,
        username: str,
        service_bind_dn: Optional[str],
        service_bind_password: Optional[str],
    ) -> List[str]:
        """
        Look up AD Trust user groups in FreeIPA compat tree using service account.
        
        This is used after AD DC pass-through authentication to get group memberships.
        
        Args:
            username: Full username with domain (user@domain)
            service_bind_dn: Service account DN
            service_bind_password: Service account password
            
        Returns:
            List of group DNs
        """
        groups = []
        
        if not service_bind_dn or not service_bind_password:
            logger.warning("No service account configured for group lookup after AD DC auth")
            return groups
        
        logger.info(f"[GROUP LOOKUP] Starting FreeIPA group lookup for AD trust user: {username}")
        logger.debug(f"[GROUP LOOKUP] Using service account: {service_bind_dn}")
        
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
            
            # Search compat groups tree with multiple username variants
            groups = self._search_ad_trust_groups(conn, username)
            
            conn.unbind()
            
            if groups:
                logger.info(f"[GROUP LOOKUP] Found {len(groups)} group(s) for {username}")
                for g in groups:
                    logger.debug(f"[GROUP LOOKUP]   - {g}")
            else:
                logger.warning(f"[GROUP LOOKUP] No groups found for {username} in FreeIPA compat tree")
            
        except Exception as e:
            logger.error(f"[GROUP LOOKUP] Error looking up groups for AD trust user {username}: {e}")
            import traceback
            logger.debug(f"[GROUP LOOKUP] Traceback: {traceback.format_exc()}")
        
        return groups
    
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
    
    def _resolve_sids_to_usernames(self, conn: 'Connection', sids: List[str]) -> Dict[str, str]:
        """
        Resolve Windows SIDs to usernames by searching the compat users tree.
        
        FreeIPA stores AD Trust users in cn=users,cn=compat with their SID in
        ipaNTSecurityIdentifier or objectSid attributes.
        
        Args:
            conn: Active LDAP connection
            sids: List of SIDs to resolve (e.g., ['S-1-5-21-xxx-262796'])
            
        Returns:
            Dict mapping SID -> username (e.g., {'S-1-5-21-xxx-262796': 'jalexander'})
        """
        resolved = {}
        if not sids:
            return resolved
            
        compat_users_base = f"cn=users,cn=compat,{self.base_dn}"
        logger.debug(f"[SID RESOLVE] Resolving {len(sids)} SID(s) from compat users tree: {compat_users_base}")
        
        for sid in sids:
            try:
                # Search for user with this SID
                # FreeIPA stores SIDs in ipaNTSecurityIdentifier or objectSid
                escaped_sid = self._ldap_escape(sid)
                sid_filter = f"(|(ipaNTSecurityIdentifier={escaped_sid})(objectSid={escaped_sid}))"
                
                conn.search(
                    search_base=compat_users_base,
                    search_filter=sid_filter,
                    search_scope=SUBTREE,
                    attributes=["uid", "cn", "gecos"],
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
                        logger.debug(f"[SID RESOLVE] Resolved {sid[-12:]}... -> {username}")
                else:
                    logger.debug(f"[SID RESOLVE] No match for SID {sid[-12:]}...")
                    
            except Exception as e:
                logger.debug(f"[SID RESOLVE] Could not resolve SID {sid}: {e}")
        
        logger.info(f"[SID RESOLVE] Resolved {len(resolved)}/{len(sids)} SIDs to usernames")
        return resolved

    def search_groups(
        self,
        bind_dn: str,
        bind_password: str,
        search_term: str = "",
        max_results: int = 100,
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
                sid_to_username = self._resolve_sids_to_usernames(conn, list(all_sids))
            
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
