# Dell iDRAC Redfish Library Files

This directory contains vendored files from Dell's official iDRAC-Redfish-Scripting repository.

## Source Repository

- **Repository**: https://github.com/dell/iDRAC-Redfish-Scripting
- **License**: Apache License 2.0
- **Directory**: Redfish Python/

## Phase 1: Priority Files (IMPLEMENTED)

### 1. Multipart Firmware Upload
**File**: `DeviceFirmwareMultipartUploadREDFISH.py`
**Download**: https://github.com/dell/iDRAC-Redfish-Scripting/blob/master/Redfish%20Python/DeviceFirmwareMultipartUploadREDFISH.py
**Purpose**: Upload DUP files directly to iDRAC without HTTP server (air-gapped support)

**Integration Status**: 
- ✅ Stub created with usage pattern
- ✅ Wrapper added to `operations.py::update_firmware_multipart()`
- ⚠️ **ACTION REQUIRED**: Replace stub with Dell's actual implementation

### 2. Firmware Inventory & Catalog Comparison
**File**: `GetFirmwareInventoryREDFISH.py`
**Download**: https://github.com/dell/iDRAC-Redfish-Scripting/blob/master/Redfish%20Python/GetFirmwareInventoryREDFISH.py
**Purpose**: Retrieve installed firmware and compare with Dell catalog

**Integration Status**:
- ✅ Stub created with usage pattern
- ✅ Wrapper added to `operations.py::get_firmware_inventory()`
- ⚠️ **ACTION REQUIRED**: Replace stub with Dell's actual implementation

## How to Complete Vendoring

1. **Download Dell Scripts**:
   ```bash
   cd job_executor/dell_redfish/lib/
   curl -O https://raw.githubusercontent.com/dell/iDRAC-Redfish-Scripting/master/Redfish%20Python/DeviceFirmwareMultipartUploadREDFISH.py
   curl -O https://raw.githubusercontent.com/dell/iDRAC-Redfish-Scripting/master/Redfish%20Python/GetFirmwareInventoryREDFISH.py
   ```

2. **Extract Reusable Functions**:
   - Review Dell's scripts for main functions
   - Preserve Dell's error handling logic
   - Keep Dell's copyright headers

3. **Test Integration**:
   ```python
   from job_executor.dell_redfish import DellOperations
   
   ops = DellOperations(adapter)
   result = ops.update_firmware_multipart(
       ip='10.0.0.1',
       username='root',
       password='calvin',
       dup_file_path='/path/to/firmware.exe',
       install_option='NextReboot'
   )
   ```

## Phase 2: System Hardware Inventory (IMPLEMENTED)

### 3. System Hardware Inventory (Memory, CPU, etc.)
**File**: `GetSystemHWInventoryREDFISH.py`
**Download**: https://github.com/dell/iDRAC-Redfish-Scripting/blob/master/Redfish%20Python/GetSystemHWInventoryREDFISH.py
**Purpose**: Retrieve memory DIMMs, processors, and other hardware inventory

**Integration Status**:
- ✅ Stub created with usage pattern and mapping documentation
- ⏳ Wrapper pending in `operations.py::get_memory_inventory()`
- ⚠️ **ACTION REQUIRED**: Replace stub with Dell's actual implementation

**Key Endpoints**:
- `/redfish/v1/Systems/System.Embedded.1/Memory` - Memory collection
- `/redfish/v1/Systems/System.Embedded.1/Memory/DIMM.Socket.X` - Individual DIMM details

## Future Files to Vendor (Phase 3+)

- **ExportSystemConfigurationREDFISH.py** - Enhanced SCP export
- **ImportSystemConfigurationREDFISH.py** - Enhanced SCP import  
- **ChangeBiosBootOrderREDFISH.py** - Boot configuration
- **GetSystemInventoryREDFISH.py** - System information

## Integration Approach

Instead of using these scripts directly, we'll:

1. **Extract core functions** from Dell's scripts
2. **Adapt function signatures** to work with our adapter
3. **Preserve Dell's logic** for API calls, error handling, and parsing
4. **Wrap with our safety layer** (throttling, logging, circuit breakers)

## Example Integration

```python
# Dell's original approach (from DeviceFirmwareSimpleUpdateREDFISH.py)
def perform_firmware_update(ip, username, password, firmware_uri):
    # Dell's tested implementation
    pass

# Our wrapped version (in operations.py)
def update_firmware_simple(self, ip, username, password, firmware_uri):
    # Use adapter to call Dell's function with safety
    return self.adapter.call_with_safety(
        perform_firmware_update,
        ip,
        "firmware_update",
        ip, username, password, firmware_uri
    )
```

## License Compliance

Dell's iDRAC-Redfish-Scripting is licensed under Apache License 2.0.
We must:
- Preserve Dell's copyright notices
- Include NOTICE file if present
- State modifications we've made
- Comply with Apache 2.0 license terms

## Next Steps

1. Review Dell's scripts to identify reusable functions
2. Download and vendor the necessary files
3. Update `operations.py` to use Dell's implementations
4. Test integration with our adapter layer
5. Document any Dell-specific quirks or requirements
