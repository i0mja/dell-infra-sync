"""
Identity Normalization Layer for FreeIPA + AD Trust Authentication

This module provides canonical identity normalization for users across:
- Native FreeIPA users (user@IDM.NEOPOST.GRP)
- AD Trust users from multiple forests (user@NEOPOST.GRP, user@NEOPOST.AD)

Supports input formats:
- Bare username: user
- UPN format: user@domain.com
- NT-style format: DOMAIN\user
"""

import re
from dataclasses import dataclass
from typing import Optional, List, Tuple
from enum import Enum


class IdentityFormat(Enum):
    """Format in which the identity was provided"""
    BARE = "bare"           # Just username: "jsmith"
    UPN = "upn"             # user@domain: "jsmith@neopost.grp"
    NT_STYLE = "nt_style"   # DOMAIN\user: "NEOPOST\jsmith"


@dataclass
class NormalizedIdentity:
    """Normalized identity information"""
    canonical_principal: str      # Full principal: user@REALM
    username: str                 # Just the username part: user
    realm: str                    # Kerberos realm: NEOPOST.GRP
    domain: str                   # Domain (lowercase): neopost.grp
    is_ad_trust: bool            # True if AD trust user, False if native IPA
    original_format: IdentityFormat
    original_input: str
    
    def __str__(self) -> str:
        return self.canonical_principal


class IdentityNormalizer:
    """
    Normalizes user identities across FreeIPA and trusted AD domains.
    
    Supports the following realms (configurable):
    - IDM.NEOPOST.GRP (native FreeIPA)
    - NEOPOST.GRP (AD trust)
    - NEOPOST.AD (AD trust)
    
    Resolution order for bare usernames:
    1. First AD trusted domain (NEOPOST.GRP)
    2. Second AD trusted domain (NEOPOST.AD)
    3. Native IPA realm (IDM.NEOPOST.GRP)
    """
    
    # Common NT-style domain prefixes mapped to their full domains
    NT_DOMAIN_MAP = {
        'NEOPOST': 'neopost.grp',
        'NEOPOST-GRP': 'neopost.grp',
        'NEOPOSTAD': 'neopost.ad',
        'NEOPOST-AD': 'neopost.ad',
    }
    
    def __init__(
        self,
        ipa_realm: str = "IDM.NEOPOST.GRP",
        ipa_domain: str = "idm.neopost.grp",
        trusted_domains: Optional[List[str]] = None,
        domain_priority: Optional[List[str]] = None
    ):
        """
        Initialize the identity normalizer.
        
        Args:
            ipa_realm: The native IPA Kerberos realm (uppercase)
            ipa_domain: The native IPA domain (lowercase)
            trusted_domains: List of trusted AD domains (lowercase)
            domain_priority: Order to try domains for bare usernames
        """
        self.ipa_realm = ipa_realm.upper()
        self.ipa_domain = ipa_domain.lower()
        self.trusted_domains = [d.lower() for d in (trusted_domains or [])]
        
        # Build domain priority order
        # Default: AD domains first (in order given), then IPA
        if domain_priority:
            self.domain_priority = [d.lower() for d in domain_priority]
        else:
            self.domain_priority = self.trusted_domains + [self.ipa_domain]
        
        # Build realm map (domain -> realm)
        self.domain_to_realm = {
            self.ipa_domain: self.ipa_realm
        }
        for domain in self.trusted_domains:
            # Realm is typically uppercase domain
            self.domain_to_realm[domain] = domain.upper()
    
    def normalize(self, identity: str) -> NormalizedIdentity:
        """
        Normalize an identity string to canonical form.
        
        Args:
            identity: Username in any supported format
            
        Returns:
            NormalizedIdentity with canonical principal, realm, etc.
            
        Examples:
            normalize("jsmith") -> jsmith@NEOPOST.GRP (first in priority)
            normalize("jsmith@neopost.grp") -> jsmith@NEOPOST.GRP
            normalize("NEOPOST\\jsmith") -> jsmith@NEOPOST.GRP
            normalize("jsmith@idm.neopost.grp") -> jsmith@IDM.NEOPOST.GRP
        """
        identity = identity.strip()
        original_input = identity
        
        # Detect format and extract username + domain
        username, domain, fmt = self._parse_identity(identity)
        
        # If bare username, use first domain in priority order
        if domain is None:
            domain = self.domain_priority[0] if self.domain_priority else self.ipa_domain
        
        # Normalize domain to lowercase
        domain = domain.lower()
        
        # Get realm for this domain
        realm = self._get_realm_for_domain(domain)
        
        # Determine if this is an AD trust user
        is_ad_trust = domain != self.ipa_domain
        
        # Build canonical principal
        canonical_principal = f"{username}@{realm}"
        
        return NormalizedIdentity(
            canonical_principal=canonical_principal,
            username=username,
            realm=realm,
            domain=domain,
            is_ad_trust=is_ad_trust,
            original_format=fmt,
            original_input=original_input
        )
    
    def _parse_identity(self, identity: str) -> Tuple[str, Optional[str], IdentityFormat]:
        """
        Parse an identity string into username and domain.
        
        Returns:
            Tuple of (username, domain_or_none, format)
        """
        # Check for NT-style format: DOMAIN\user
        if '\\' in identity:
            parts = identity.split('\\', 1)
            if len(parts) == 2:
                nt_domain, username = parts
                # Map NT domain prefix to full domain
                domain = self._resolve_nt_domain(nt_domain)
                return username.lower(), domain, IdentityFormat.NT_STYLE
        
        # Check for UPN format: user@domain
        if '@' in identity:
            parts = identity.rsplit('@', 1)
            if len(parts) == 2:
                username, domain = parts
                return username.lower(), domain.lower(), IdentityFormat.UPN
        
        # Bare username
        return identity.lower(), None, IdentityFormat.BARE
    
    def _resolve_nt_domain(self, nt_domain: str) -> str:
        """
        Resolve an NT-style domain prefix to a full domain name.
        
        Args:
            nt_domain: NT domain prefix like "NEOPOST" or "NEOPOST-GRP"
            
        Returns:
            Full domain name like "neopost.grp"
        """
        nt_upper = nt_domain.upper()
        
        # Check static map first
        if nt_upper in self.NT_DOMAIN_MAP:
            return self.NT_DOMAIN_MAP[nt_upper]
        
        # Try to match against trusted domains
        for domain in self.trusted_domains:
            # Check if NT domain is a prefix of the full domain
            domain_prefix = domain.split('.')[0].upper()
            if nt_upper == domain_prefix:
                return domain
        
        # Fallback: assume it's a domain prefix
        return nt_domain.lower()
    
    def _get_realm_for_domain(self, domain: str) -> str:
        """
        Get the Kerberos realm for a domain.
        
        Args:
            domain: Domain name (lowercase)
            
        Returns:
            Kerberos realm (uppercase)
        """
        domain = domain.lower()
        
        if domain in self.domain_to_realm:
            return self.domain_to_realm[domain]
        
        # Check if domain is a variation of a known domain
        for known_domain, realm in self.domain_to_realm.items():
            if domain == known_domain or domain.endswith('.' + known_domain):
                return realm
        
        # Default: uppercase the domain
        return domain.upper()
    
    def is_ad_trust_domain(self, domain: str) -> bool:
        """Check if a domain is an AD trust domain."""
        return domain.lower() in self.trusted_domains
    
    def get_all_possible_principals(self, username: str) -> List[str]:
        """
        Get all possible principals for a bare username.
        Useful for trying authentication in priority order.
        
        Args:
            username: Bare username
            
        Returns:
            List of principals in priority order
        """
        principals = []
        for domain in self.domain_priority:
            realm = self._get_realm_for_domain(domain)
            principals.append(f"{username}@{realm}")
        return principals


def normalize_group_name(group_dn_or_name: str) -> str:
    """
    Normalize a group name from various formats to a simple name.
    
    Handles:
    - Full LDAP DN: cn=admins,cn=groups,cn=accounts,dc=idm,dc=neopost,dc=grp -> admins
    - NT-style: NEOPOST\Server-Admins -> server-admins
    - Simple name: Server-Admins -> server-admins
    
    Args:
        group_dn_or_name: Group identifier in any format
        
    Returns:
        Normalized group name (lowercase, no domain prefix)
    """
    if not group_dn_or_name:
        return ""
    
    name = group_dn_or_name.strip()
    
    # Handle LDAP DN format: cn=groupname,cn=groups,...
    if name.lower().startswith('cn='):
        # Extract first CN value
        match = re.match(r'^cn=([^,]+)', name, re.IGNORECASE)
        if match:
            name = match.group(1)
    
    # Handle NT-style: DOMAIN\group
    if '\\' in name:
        name = name.split('\\', 1)[-1]
    
    # Handle UPN-style: group@domain
    if '@' in name:
        name = name.split('@', 1)[0]
    
    # Lowercase and strip whitespace
    return name.lower().strip()


def groups_match(user_group: str, mapping_group: str) -> bool:
    """
    Check if a user's group matches a mapping group.
    
    Uses normalized comparison to handle different formats.
    
    Args:
        user_group: Group from user's authentication result
        mapping_group: Group from idm_group_mappings table
        
    Returns:
        True if groups match (after normalization)
    """
    norm_user = normalize_group_name(user_group)
    norm_mapping = normalize_group_name(mapping_group)
    
    # Exact match after normalization
    if norm_user == norm_mapping:
        return True
    
    # Also check if one contains the other (for partial matches)
    # This handles cases like "dsm-admins" matching "cn=dsm-admins,..."
    if norm_user and norm_mapping:
        if norm_user in norm_mapping or norm_mapping in norm_user:
            return True
    
    return False
