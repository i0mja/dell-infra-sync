"""
HMAC request signing for secure communication with Supabase Edge Functions.

This module provides request signing using HMAC-SHA256 to authenticate
the Job Executor when calling edge functions like update-job and send-notification.

The signature prevents:
- Unauthorized callers (they don't have the shared secret)
- Replay attacks (timestamp must be within 5 minutes)
- Tampering (any payload modification invalidates signature)
"""

import hmac
import hashlib
import json
import time
import os
import logging
import requests
from typing import Dict, Tuple, Optional

# Cache the shared secret to avoid repeated API calls
_cached_secret: Optional[str] = None
_secret_fetch_attempted: bool = False


def _fetch_secret_from_database() -> Optional[str]:
    """
    Fetch the shared secret from the database via edge function.
    This is called when the environment variable is not set.
    """
    global _cached_secret, _secret_fetch_attempted
    
    # Only attempt once per session to avoid repeated failures
    if _secret_fetch_attempted:
        return _cached_secret
    
    _secret_fetch_attempted = True
    
    try:
        dsm_url = os.getenv('DSM_URL')
        service_role_key = os.getenv('SERVICE_ROLE_KEY')
        
        if not dsm_url or not service_role_key:
            logging.warning("DSM_URL or SERVICE_ROLE_KEY not set - cannot fetch secret from database")
            return None
        
        # Call the edge function to get the decrypted secret
        url = f"{dsm_url}/functions/v1/set-executor-secret"
        headers = {
            'Authorization': f'Bearer {service_role_key}',
            'Content-Type': 'application/json',
        }
        payload = {'action': 'get-decrypted'}
        
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            secret = data.get('secret')
            if secret:
                _cached_secret = secret
                logging.info("Successfully fetched executor shared secret from database")
                return secret
            else:
                logging.warning("Secret not found in database response")
        elif response.status_code == 404:
            logging.warning("Executor shared secret not configured in database. Configure it in Settings > Infrastructure > Job Executor")
        else:
            logging.warning(f"Failed to fetch secret from database: {response.status_code} - {response.text}")
        
    except requests.exceptions.RequestException as e:
        logging.warning(f"Error fetching secret from database: {e}")
    except Exception as e:
        logging.error(f"Unexpected error fetching secret: {e}")
    
    return None


def get_shared_secret() -> Optional[str]:
    """
    Get the shared secret from environment variable or database.
    
    Priority:
    1. EXECUTOR_SHARED_SECRET environment variable (for backward compatibility)
    2. Encrypted secret stored in database (set via GUI)
    """
    global _cached_secret
    
    # First check environment variable
    secret = os.getenv('EXECUTOR_SHARED_SECRET')
    if secret:
        return secret
    
    # If cached secret exists, use it
    if _cached_secret:
        return _cached_secret
    
    # Try to fetch from database
    secret = _fetch_secret_from_database()
    if secret:
        return secret
    
    # Log warning if no secret is available
    logging.warning(
        "EXECUTOR_SHARED_SECRET not set and not configured in database. "
        "HMAC signing disabled. Job status updates will fail if edge function requires authentication. "
        "Configure the secret in Settings > Infrastructure > Job Executor."
    )
    return None


def _sorted_json_stringify(obj) -> str:
    """
    JSON stringify with sorted keys to ensure consistent signature.
    Must match the TypeScript implementation exactly.
    """
    if obj is None:
        return 'null'
    if isinstance(obj, bool):
        return 'true' if obj else 'false'
    if isinstance(obj, (int, float)):
        return json.dumps(obj)
    if isinstance(obj, str):
        return json.dumps(obj)
    if isinstance(obj, list):
        items = ','.join(_sorted_json_stringify(item) for item in obj)
        return f'[{items}]'
    if isinstance(obj, dict):
        sorted_keys = sorted(obj.keys())
        items = ','.join(
            f'{json.dumps(key)}:{_sorted_json_stringify(obj[key])}'
            for key in sorted_keys
        )
        return '{' + items + '}'
    # Fallback for other types
    return json.dumps(obj)


def sign_request(payload: Dict) -> Tuple[str, str]:
    """
    Sign a request payload with HMAC-SHA256.
    
    Args:
        payload: The JSON payload to sign
        
    Returns:
        Tuple of (signature, timestamp) to add to request headers
        
    Raises:
        ValueError: If EXECUTOR_SHARED_SECRET is not configured
    """
    secret = get_shared_secret()
    if not secret:
        # No secret configured - return empty headers for backward compatibility
        return '', ''
    
    timestamp = str(int(time.time()))
    
    # Create message: sorted JSON + timestamp
    message = _sorted_json_stringify(payload) + timestamp
    
    # Compute HMAC-SHA256 signature
    signature = hmac.new(
        secret.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return signature, timestamp


def add_signature_headers(headers: Dict, payload: Dict) -> Dict:
    """
    Add HMAC signature headers to an existing headers dict.
    
    Args:
        headers: Existing headers dict (will not be modified)
        payload: The JSON payload being sent
        
    Returns:
        New headers dict with signature headers added
    """
    signature, timestamp = sign_request(payload)
    
    # Create new headers dict with signature
    new_headers = dict(headers)
    
    if signature and timestamp:
        new_headers['X-Executor-Signature'] = signature
        new_headers['X-Executor-Timestamp'] = timestamp
    
    return new_headers
