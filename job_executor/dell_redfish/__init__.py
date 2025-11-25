"""
Dell iDRAC Redfish Integration Module

This module provides an adapter layer between Dell's official iDRAC-Redfish-Scripting
library and our custom throttling/logging infrastructure.

The adapter ensures all Dell library calls go through:
- IdracThrottler for rate limiting and circuit breakers
- Supabase logging for idrac_commands table
- Consistent error handling and retry logic
"""

__version__ = "1.0.0"

from .adapter import DellRedfishAdapter
from .operations import DellOperations
from .helpers import DellRedfishHelpers
from .errors import (
    DellRedfishError,
    CircuitBreakerOpenError,
    DellErrorCodes,
    map_dell_error,
)

__all__ = [
    "DellRedfishAdapter",
    "DellOperations",
    "DellRedfishHelpers",
    "DellRedfishError",
    "CircuitBreakerOpenError",
    "DellErrorCodes",
    "map_dell_error",
]
