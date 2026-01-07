"""
NFS export management endpoints.
"""

import subprocess
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from zfs_agent.config import settings

router = APIRouter(prefix="/v1/exports", tags=["nfs"])


class NFSExport(BaseModel):
    """NFS export entry."""
    path: str
    clients: str
    options: str


class NFSExportListResponse(BaseModel):
    """Response for export listing."""
    exports: List[NFSExport]
    count: int


class CreateExportRequest(BaseModel):
    """Request to create an NFS export."""
    path: str
    network: str = "*"  # e.g., "10.0.0.0/8" or "*" for all
    options: str = "rw,no_root_squash,async,no_subtree_check,crossmnt,nohide"


class CreateExportResponse(BaseModel):
    """Response for creating an export."""
    success: bool
    message: str
    path: str


def _parse_exports_file() -> List[NFSExport]:
    """Parse /etc/exports file."""
    exports = []
    try:
        with open("/etc/exports", "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                
                # Parse: /path client(options)
                parts = line.split(None, 1)
                if len(parts) >= 2:
                    path = parts[0]
                    rest = parts[1]
                    
                    # Parse client(options)
                    if "(" in rest:
                        client = rest.split("(")[0]
                        options = rest.split("(")[1].rstrip(")")
                    else:
                        client = rest
                        options = ""
                    
                    exports.append(NFSExport(
                        path=path,
                        clients=client,
                        options=options
                    ))
    except FileNotFoundError:
        pass
    except Exception as e:
        pass
    
    return exports


def _run_exportfs() -> List[NFSExport]:
    """Get active exports from exportfs."""
    exports = []
    try:
        result = subprocess.run(
            [settings.exportfs_binary, "-v"],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        for line in result.stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            
            # Parse: /path client(options)
            parts = line.split()
            if len(parts) >= 2:
                path = parts[0]
                client_opts = parts[1]
                
                if "(" in client_opts:
                    client = client_opts.split("(")[0]
                    options = client_opts.split("(")[1].rstrip(")")
                else:
                    client = client_opts
                    options = ""
                
                exports.append(NFSExport(
                    path=path,
                    clients=client,
                    options=options
                ))
    except Exception as e:
        pass
    
    return exports


@router.get("", response_model=NFSExportListResponse)
async def list_exports():
    """
    List all NFS exports.
    
    Returns both configured exports (/etc/exports) and active exports.
    """
    exports = _run_exportfs()
    if not exports:
        exports = _parse_exports_file()
    
    return NFSExportListResponse(exports=exports, count=len(exports))


@router.post("", response_model=CreateExportResponse)
async def create_export(request: CreateExportRequest):
    """
    Create a new NFS export.
    
    Adds entry to /etc/exports and runs exportfs -ra.
    """
    path = request.path
    network = request.network
    options = request.options
    
    # Validate path exists
    import os
    if not os.path.isdir(path):
        raise HTTPException(status_code=400, detail=f"Path does not exist: {path}")
    
    # Check if already exported
    existing = _parse_exports_file()
    for exp in existing:
        if exp.path == path:
            raise HTTPException(status_code=409, detail=f"Path already exported: {path}")
    
    # Add to /etc/exports
    export_line = f"{path} {network}({options})\n"
    
    try:
        with open("/etc/exports", "a") as f:
            f.write(export_line)
    except PermissionError:
        raise HTTPException(status_code=500, detail="Permission denied writing to /etc/exports")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
    # Refresh exports
    try:
        result = subprocess.run(
            [settings.exportfs_binary, "-ra"],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"exportfs failed: {result.stderr}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="exportfs timed out")
    
    return CreateExportResponse(
        success=True,
        message=f"Export created: {path}",
        path=path
    )


@router.delete("/{path:path}")
async def delete_export(path: str):
    """
    Remove an NFS export.
    """
    # Read current exports
    try:
        with open("/etc/exports", "r") as f:
            lines = f.readlines()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No exports configured")
    
    # Filter out the export
    new_lines = []
    found = False
    for line in lines:
        if line.strip().startswith(path + " ") or line.strip() == path:
            found = True
        else:
            new_lines.append(line)
    
    if not found:
        raise HTTPException(status_code=404, detail=f"Export not found: {path}")
    
    # Write back
    try:
        with open("/etc/exports", "w") as f:
            f.writelines(new_lines)
    except PermissionError:
        raise HTTPException(status_code=500, detail="Permission denied")
    
    # Refresh exports
    subprocess.run([settings.exportfs_binary, "-ra"], capture_output=True)
    
    return {"success": True, "message": f"Export removed: {path}"}
