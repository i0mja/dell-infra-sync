import sys
from typing import Any

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
        text = response.text[:500] if hasattr(response, "text") else str(response.content[:500])
        stripped = text.strip() if isinstance(text, str) else ""

        if stripped.startswith("<SystemConfiguration"):
            # SCP exports return XML payloads; treat as completed task output
            return {
                "TaskState": "Completed",
                "PercentComplete": 100,
                "Messages": [{"Message": stripped}],
                "_raw_response": text,
                "_parse_error": "Response returned XML instead of JSON"
            }

        return {"_raw_response": text, "_parse_error": "Not valid JSON"}
