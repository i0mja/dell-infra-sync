#!/usr/bin/env python3
# Copyright (c) 2018, Dell, Inc.
# Licensed under GPLv2
#
# DELL OFFICIAL SCRIPT STUB - SYSTEM HARDWARE INVENTORY
#
# Download actual implementation from:
# https://github.com/dell/iDRAC-Redfish-Scripting/blob/master/Redfish%20Python/GetSystemHWInventoryREDFISH.py
#
# Dell's script provides:
# - --memory: Get memory/DIMM information
# - --processor: Get CPU information  
# - --storage: Get storage information
# - --network: Get network device information
# - --fan, --powersupply: Thermal/power info
# - --all: Get everything
#
# Memory endpoint: /redfish/v1/Systems/System.Embedded.1/Memory
# Each DIMM: /redfish/v1/Systems/System.Embedded.1/Memory/DIMM.Socket.X
#
# ==============================================================================
# USAGE EXAMPLE (for job executor integration):
# ==============================================================================
#
# def get_memory_information(idrac_ip: str, username: str, password: str) -> list:
#     """
#     Fetch memory/DIMM inventory from iDRAC via Redfish.
#     
#     Returns list of dicts with:
#     - Id: "DIMM.Socket.A1"
#     - Name: "DIMM A1"
#     - Status: {"Health": "OK", "State": "Enabled"}
#     - CapacityMiB: 32768
#     - Manufacturer: "Samsung"
#     - SerialNumber: "M393A4K40EB3..."
#     - PartNumber: "M393A4K40EB3-CWE"
#     - MemoryDeviceType: "DDR4"
#     - OperatingSpeedMhz: 3200
#     - RankCount: 2
#     - ErrorCorrection: "MultiBitECC"
#     
#     Plus Dell OEM extensions (Oem.Dell.DellMemory):
#     - MemoryTechnology
#     - RemainingRatedWriteEndurancePercent (for NVDIMMs)
#     """
#     import requests
#     from requests.auth import HTTPBasicAuth
#     
#     base_url = f"https://{idrac_ip}/redfish/v1/Systems/System.Embedded.1/Memory"
#     auth = HTTPBasicAuth(username, password)
#     
#     # Get memory collection
#     response = requests.get(base_url, auth=auth, verify=False)
#     response.raise_for_status()
#     collection = response.json()
#     
#     dimms = []
#     for member in collection.get("Members", []):
#         dimm_url = f"https://{idrac_ip}{member['@odata.id']}"
#         dimm_response = requests.get(dimm_url, auth=auth, verify=False)
#         if dimm_response.ok:
#             dimms.append(dimm_response.json())
#     
#     return dimms
#
# ==============================================================================
# MAPPING TO server_memory TABLE:
# ==============================================================================
#
# For each DIMM returned, map to database columns:
#
# dimm_data = {
#     'server_id': server_id,  # From parent context
#     'dimm_identifier': data['Id'],  # "DIMM.Socket.B2"
#     'slot_name': extract_slot_name(data['Id']),  # "B2"
#     'health': data['Status']['Health'],  # "OK", "Warning", "Critical"
#     'status': data['Status']['State'],  # "Enabled", "Disabled", "Absent"
#     'capacity_mb': data.get('CapacityMiB'),
#     'manufacturer': data.get('Manufacturer'),
#     'serial_number': data.get('SerialNumber'),
#     'part_number': data.get('PartNumber'),
#     'memory_type': data.get('MemoryDeviceType'),
#     'speed_mhz': data.get('AllowedSpeedsMHz', [None])[0] if data.get('AllowedSpeedsMHz') else None,
#     'operating_speed_mhz': data.get('OperatingSpeedMhz'),
#     'rank_count': data.get('RankCount'),
#     'error_correction': data.get('ErrorCorrection'),
#     'volatile_size_mb': data.get('VolatileSizeMiB'),
#     'non_volatile_size_mb': data.get('NonVolatileSizeMiB'),
#     'last_updated_at': datetime.utcnow().isoformat(),
# }
#
# def extract_slot_name(dimm_id: str) -> str:
#     """Extract slot name from DIMM identifier."""
#     import re
#     match = re.search(r'DIMM\.Socket\.(\w+)', dimm_id)
#     return match.group(1) if match else dimm_id
#
# ==============================================================================
#
# IMPLEMENTATION NOTE:
# The memory fetching is now implemented directly in:
#   job_executor/mixins/idrac_ops.py -> _fetch_memory_dimms()
#
# This follows the Dell pattern documented above and uses:
# - $expand optimization for bulk fetching
# - Parallel fetch with drives/NICs/health
# - PostgREST bulk upsert to server_memory table
#
# The Dell script is kept as reference for other hardware inventory needs.
# ==============================================================================

def get_memory_information(idrac_ip: str, username: str, password: str) -> list:
    """
    Stub - actual implementation is in job_executor/mixins/idrac_ops.py::_fetch_memory_dimms()
    
    This stub is kept for reference. See idrac_ops.py for production implementation.
    """
    raise NotImplementedError(
        "Use IdracMixin._fetch_memory_dimms() from job_executor/mixins/idrac_ops.py instead"
    )
