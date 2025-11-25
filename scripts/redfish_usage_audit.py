from __future__ import annotations

"""Audit Redfish endpoint usage across the codebase.

This utility scans all source files for Redfish endpoint strings and verifies
that each one matches a canonical endpoint defined within the
`job_executor/dell_redfish` adapter layer. The Dell adapter already
encapsulates every supported API path; other parts of the application should
not invent new endpoints without updating that canonical source.
"""

import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Set, Tuple


# Allow imports from the repository root when executed as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from job_executor.dell_redfish.endpoints import CANONICAL_REDFISH_ENDPOINTS

REPO_ROOT = Path(__file__).resolve().parent.parent
CANONICAL_ROOT = REPO_ROOT / "job_executor" / "dell_redfish"

# File extensions we treat as source for endpoint usage
CODE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".ps1"}

ENDPOINT_PATTERN = re.compile(r"/redfish/v1(?:/[A-Za-z0-9._{}\-/]+)?")


def should_skip_dir(path: Path) -> bool:
    """Return True if directory should be excluded from the scan."""
    skip_names = {
        ".git",
        "node_modules",
        "dist",
        "build",
        "__pycache__",
    }
    return path.name in skip_names


def extract_endpoints_from_file(path: Path) -> List[str]:
    """Extract all Redfish endpoint strings from a file."""
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, UnicodeDecodeError):
        return []
    return ENDPOINT_PATTERN.findall(text)


def collect_canonical_endpoints() -> Set[str]:
    """Collect canonical endpoints from the dell_redfish adapter layer."""
    return set(CANONICAL_REDFISH_ENDPOINTS)


def walk_code_files(base: Path) -> Iterable[Path]:
    """Yield all source files we want to scan."""
    for root, dirs, files in os.walk(base):
        # Remove directories we want to skip from traversal
        dirs[:] = [d for d in dirs if not should_skip_dir(Path(d))]
        for filename in files:
            path = Path(root) / filename
            if path.suffix.lower() not in CODE_EXTENSIONS:
                continue
            yield path


def audit_endpoints() -> Tuple[Set[str], Dict[Path, List[str]]]:
    """Run the audit and return canonical endpoints and violations."""
    canonical = collect_canonical_endpoints()
    violations: Dict[Path, List[str]] = defaultdict(list)

    for path in walk_code_files(REPO_ROOT):
        # Skip the canonical directory itself to avoid self-reporting
        if CANONICAL_ROOT in path.parents:
            continue

        endpoints = extract_endpoints_from_file(path)
        for endpoint in endpoints:
            if endpoint not in canonical:
                violations[path].append(endpoint)

    return canonical, violations


def format_report(canonical: Set[str], violations: Dict[Path, List[str]]) -> str:
    """Create a human-friendly report of the audit."""
    lines = [
        "# Redfish Endpoint Audit",
        "",
        "This report compares every Redfish endpoint reference across the codebase",
        "against the canonical list defined in `job_executor/dell_redfish`.",
        "",
        f"- Canonical endpoints found: {len(canonical)}",
        f"- Files scanned: {sum(1 for _ in walk_code_files(REPO_ROOT))}",
        f"- Files with non-canonical endpoints: {len(violations)}",
        "",
    ]

    if not violations:
        lines.append("## Status\n\nAll scanned files use endpoints defined in the canonical adapter layer.")
        return "\n".join(lines)

    lines.append("## Non-canonical Endpoint References\n")
    for path, endpoints in sorted(violations.items()):
        lines.append(f"### {path.relative_to(REPO_ROOT)}")
        for endpoint in sorted(set(endpoints)):
            lines.append(f"- `{endpoint}`")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    canonical, violations = audit_endpoints()
    report = format_report(canonical, violations)
    output_path = REPO_ROOT / "docs" / "REDFISH_USAGE_REPORT.md"
    output_path.write_text(report, encoding="utf-8")
    print(report)
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
