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
from typing import Dict, Tuple, Optional


def get_shared_secret() -> Optional[str]:
    """Get the shared secret from environment variable."""
    secret = os.getenv('EXECUTOR_SHARED_SECRET')
    if not secret:
        # Log warning to help debug missing secret
        import logging
        logging.warning("EXECUTOR_SHARED_SECRET not set - HMAC signing disabled. Job status updates will fail if edge function requires authentication.")
    return secret


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
