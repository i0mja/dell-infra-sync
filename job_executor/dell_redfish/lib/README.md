# Dell iDRAC Redfish Library Files

This directory contains vendored files from Dell's official iDRAC-Redfish-Scripting repository.

## Source Repository

- **Repository**: https://github.com/dell/iDRAC-Redfish-Scripting
- **License**: Apache License 2.0
- **Directory**: Redfish Python/

## Files to Vendor

Based on our needs, we should vendor these key files from Dell's repository:

### Core Support Files
- **DeviceFirmwareSimpleUpdateREDFISH.py** - Firmware update implementation
- **ExportSystemConfigurationREDFISH.py** - SCP export
- **ImportSystemConfigurationREDFISH.py** - SCP import
- **ChangeBiosBootOrderREDFISH.py** - Boot configuration
- **SetOneTimeBootDeviceREDFISH.py** - One-time boot
- **GetSystemInventoryREDFISH.py** - System information
- **PowerControlREDFISH.py** - Power management
- **GetServerPOSTStateREDFISH.py** - POST state monitoring

### How to Vendor

1. Download relevant scripts from Dell's repository
2. Place them in this directory
3. Update our `operations.py` to import and use these Dell functions
4. Wrap all calls through the `DellRedfishAdapter` for safety

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
