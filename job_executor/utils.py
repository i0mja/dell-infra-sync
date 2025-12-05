import sys
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    """Return current UTC time as ISO format string with timezone info."""
    return datetime.now(timezone.utc).isoformat()


UNICODE_FALLBACKS = {
    "\u2713": "[OK]",   # ✓
    "\u2717": "[X]",    # ✗
    "\u2026": "...",    # …
    "\u2013": "-",      # –
    "\u2014": "-",      # —
}


def _normalize_unicode(text: str) -> str:
    """Replace problematic Unicode characters with ASCII equivalents."""
    for bad, repl in UNICODE_FALLBACKS.items():
        text = text.replace(bad, repl)
    return text


def _safe_to_stdout(text: str) -> str:
    """Ensure text can be encoded to stdout without exceptions."""
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        return text.encode(enc, errors="replace").decode(enc, errors="replace")
    except Exception:
        return text.encode("ascii", errors="replace").decode("ascii", errors="replace")


def _safe_json_parse(response: Any):
    """Safely parse JSON response, returning dict or text on failure."""
    try:
        return response.json()
    except Exception:
        # CRITICAL: Get FULL response text for SCP exports - NEVER truncate XML!
        full_text = response.text if hasattr(response, "text") else str(response.content)
        stripped = full_text.strip() if isinstance(full_text, str) else ""

        if stripped.startswith("<SystemConfiguration"):
            # SCP exports return XML payloads - return FULL content, not truncated
            return {
                "TaskState": "Completed",
                "PercentComplete": 100,
                "Messages": [{"Message": stripped}],
                "_raw_response": full_text,  # FULL response, not truncated
                "_scp_xml": True,
                "_parse_error": "Response returned XML instead of JSON"
            }

        # For non-SCP responses, truncate for logging purposes only
        return {"_raw_response": full_text[:2000], "_parse_error": "Not valid JSON"}
