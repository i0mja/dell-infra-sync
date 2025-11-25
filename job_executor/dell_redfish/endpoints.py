"""Canonical Dell iDRAC Redfish endpoints used by the application.

This list represents every Redfish path the application is permitted to use.
The paths are sourced from the Dell adapter layer and job executor workflows
and should be updated whenever new Dell API capabilities are added. Keeping
this centralized makes it easy to verify the rest of the codebase never drifts
away from the supported Dell contract.
"""

CANONICAL_REDFISH_ENDPOINTS = {
    "/redfish/v1/",
    "/redfish/v1",
    "/redfish/v1/Chassis/System.Embedded.1",
    "/redfish/v1/Chassis/System.Embedded.1/Power",
    "/redfish/v1/Chassis/System.Embedded.1/Thermal",
    "/redfish/v1/Managers/iDRAC.Embedded.1",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Attributes",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/JID_xxx",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{job_id}",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Jobs/{job_id_str}",
    "/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries",
    "/redfish/v1/Managers/iDRAC.Embedded.1/Logs/Sel",
    "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia",
    "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{Id}/Actions/VirtualMedia.EjectMedia",
    "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{Id}/Actions/VirtualMedia.InsertMedia",
    "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{device_id}/Actions/VirtualMedia.EjectMedia",
    "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{device_id}/Actions/VirtualMedia.InsertMedia",
    "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/{media_slot}",
    "/redfish/v1/SessionService/Sessions",
    "/redfish/v1/SessionService/Sessions/1",
    "/redfish/v1/SessionService/Sessions/{sessionId}",
    "/redfish/v1/Systems/System.Embedded.1",
    "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset",
    "/redfish/v1/Systems/System.Embedded.1/Bios",
    "/redfish/v1/Systems/System.Embedded.1/Bios/Settings",
    "/redfish/v1/Systems/System.Embedded.1/Memory",
    "/redfish/v1/Systems/System.Embedded.1/NetworkInterfaces",
    "/redfish/v1/Systems/System.Embedded.1/Processors",
    "/redfish/v1/Systems/System.Embedded.1/Storage",
    "/redfish/v1/TaskService/Tasks/JID_123",
    "/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate",
    "/redfish/v1/UpdateService/FirmwareInventory",
}
