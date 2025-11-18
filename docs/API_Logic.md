# API_LOGIC.md
# LLM Action Catalogue for Dell iDRAC + VMware vCenter
# Format: Option C – [action:*] blocks for orchestration agents

# =====================================================
# 0. CONVENTIONS & GLOBALS
# =====================================================

[action:globals.conventions]
purpose = "Explain shared conventions for all actions in this file"
base_urls = {
  "idrac": "https://<idrac-hostname-or-ip>",
  "vcenter": "https://<vcenter-hostname-or-ip>"
}
auth = [
  "iDRAC: HTTP Basic Auth OR Redfish Session (X-Auth-Token header).",
  "vCenter: vmware-api-session-id header from /api/session."
]
placeholders = {
  "<idrac>": "FQDN or IP of the iDRAC interface",
  "<vcenter>": "FQDN of vCenter",
  "<host-id>": "Managed object ID for an ESXi host (e.g. host-1234)",
  "<cluster-id>": "Managed object ID for a vSphere cluster",
  "<vm-id>": "Managed object ID for a VM",
  "<job-id>": "Redfish Task or Dell Job ID"
}
http_conventions = [
  "All requests use HTTPS.",
  "Self-signed certificates may require -k/verify=False in clients.",
  "Long-running operations usually return HTTP 202 with a job/task link."
]
agent_usage = "Each [action:*] can be treated as a callable capability by an LLM-based orchestrator. Use workflow.* actions to chain capabilities."

# =====================================================
# 1. ENVIRONMENT / MAPPING HELPERS
# =====================================================

[action:env.host_idrac_map.get]
purpose = "Resolve ESXi host to corresponding iDRAC endpoint"
inputs = {
  "host_name": "ESXi hostname (FQDN) as seen in vCenter OR",
  "host_ip": "Management IP as seen in vCenter (optional)",
  "service_tag": "Optional Dell Service Tag if used as key"
}
source = "Application-side config (DB/YAML/JSON) – NOT an external API."
returns = "Object like { 'idrac_host': '10.0.0.10', 'service_tag': 'ABC1234', 'model': 'PowerEdge R740xd' }"
notes = [
  "This mapping must be maintained by the application.",
  "The LLM should assume this is available and call it before iDRAC actions."
]

[action:env.cluster_host_list.resolve]
purpose = "Resolve vSphere cluster ID or name into ordered host list for rolling updates"
inputs = {
  "cluster_name_or_id": "Human-friendly name or vCenter cluster ID",
  "filter": "Optional filter like { 'only_connected': true }"
}
returns = "Ordered list of host objects: [{ 'host_id': 'host-1001', 'name': 'esx01', 'idrac_host': '10.0.0.11' }, ...]"
notes = [
  "Ordering can be by name, IP, or custom weighting (e.g., lightest hosts first).",
  "Used by workflow.update_cluster."
]

# =====================================================
# 2. DELL iDRAC REDFISH – AUTH & CORE SYSTEM INFO
# =====================================================

[action:idrac.auth.session.create]
purpose = "Create a Redfish session on iDRAC and return X-Auth-Token"
method = "POST"
url_template = "https://<idrac>/redfish/v1/SessionService/Sessions"
headers = { "Content-Type": "application/json" }
body_example = {
  "UserName": "<idrac-user>",
  "Password": "<idrac-pass>"
}
returns = {
  "headers.X-Auth-Token": "Token string for subsequent calls.",
  "headers.Location": "Session resource URI (optional)."
}
success_condition = "HTTP 201 Created"
failure_handling = [
  "4xx: bad credentials or insufficient privilege.",
  "5xx: iDRAC unhealthy – abort firmware workflow."
]

[action:idrac.auth.session.delete]
purpose = "Delete an existing Redfish session (logout)"
method = "DELETE"
url_template = "https://<idrac><session-location-from-login>"
headers = { "X-Auth-Token": "<token>" }
success_condition = "HTTP 200 or 204"
notes = "Optional clean-up; not required if using Basic Auth per request."

[action:idrac.system.info]
purpose = "Retrieve full system information including health rollup"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1"
headers = { "Authorization": "Basic or X-Auth-Token" }
returns = {
  "Model": "Server model, e.g. PowerEdge R740xd",
  "SerialNumber": "Dell Service Tag",
  "Status": {
    "Health": "OK|Warning|Critical",
    "HealthRollup": "Rollup status over subsystems"
  },
  "BiosVersion": "Current BIOS firmware version",
  "ProcessorSummary": "...",
  "MemorySummary": "..."
}
success_condition = "HTTP 200 and Status.HealthRollup available"

[action:idrac.chassis.thermal]
purpose = "Get temperature and fan sensor data"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Chassis/System.Embedded.1/Thermal"
returns = "Temperatures and fan readings"
usage = "Optional pre/post check to ensure thermals are normal before/after firmware."

[action:idrac.chassis.power]
purpose = "Get power readings for the chassis"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Chassis/System.Embedded.1/Power"
returns = "Power consumption, PSU status"
usage = "Optional telemetry for health and capacity dashboards."

# =====================================================
# 3. DELL iDRAC – FIRMWARE INVENTORY & UPDATE
# =====================================================

[action:idrac.firmware.inventory.list]
purpose = "List all installed firmware components and versions"
method = "GET"
url_template = "https://<idrac>/redfish/v1/UpdateService/FirmwareInventory"
returns = [
  "Entries for BIOS, iDRAC, RAID controller, NICs, etc.",
  "Each entry typically includes Id, Name, Version, Updateable flag."
]
usage = [
  "Use before update to decide if newer firmware is required.",
  "Use after update to verify version change."
]

[action:idrac.update.simple]
purpose = "Stage and apply firmware image via network URL (SimpleUpdate)"
method = "POST"
url_template = "https://<idrac>/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate"
headers = { "Content-Type": "application/json" }
body_example = {
  "ImageURI": "https://repo.example.com/firmware/idrac_6.10.00.exe",
  "TransferProtocol": "HTTPS"
}
returns = {
  "http_status": 202,
  "location_header": "/redfish/v1/TaskService/Tasks/JID_123456 (example)"
}
success_condition = "HTTP 202 Accepted with task/job reference"
notes = [
  "Best used when a central firmware repository is available.",
  "May create Redfish Task and/or Dell OEM Job."
]

[action:idrac.update.upload_stage]
purpose = "Upload firmware package directly to iDRAC via multipart form-data"
method = "POST"
url_template = "https://<idrac>/redfish/v1/UpdateService/FirmwareInventory"
headers = {
  "Content-Type": "multipart/form-data",
  "If-Match": "<ETag-from-GET-FirmwareInventory>"
}
body_example = "form field 'file' = @<firmware_file>"
returns = "Firmware package appears in 'Available' inventory."
success_condition = "HTTP 200/202 and package visible under FirmwareInventory/Available"

[action:idrac.update.apply_staged]
purpose = "Apply firmware that has already been uploaded/staged"
method = "POST"
url_template = "https://<idrac>/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate"
headers = { "Content-Type": "application/json" }
body_example = {
  "SoftwareIdentityURI": "/redfish/v1/UpdateService/FirmwareInventory/Available/<package-id>"
}
success_condition = "HTTP 202 and job/task created"
usage = "Use after idrac.update.upload_stage instead of network URL."

# =====================================================
# 4. DELL iDRAC – JOB / TASK MONITORING
# =====================================================

[action:idrac.task.get]
purpose = "Fetch status of a Redfish Task by ID"
method = "GET"
url_template = "https://<idrac>/redfish/v1/TaskService/Tasks/<job-id>"
returns = {
  "TaskState": "New|Running|Completed|Exception|Killed",
  "PercentComplete": "0–100",
  "Messages": "Array of status or error messages"
}
success_condition = "HTTP 200 and TaskState present"

[action:idrac.task.wait_for_state]
purpose = "Poll a Redfish Task until desired state or timeout"
inputs = {
  "job_id": "Task ID (e.g. JID_123456)",
  "desired_states": ["Completed"],
  "timeout_seconds": 3600,
  "poll_interval_seconds": 15
}
implementation_hint = [
  "Loop: call idrac.task.get, sleep poll_interval_seconds.",
  "Exit success when TaskState in desired_states.",
  "Exit failure if TaskState in ['Exception', 'Killed'] or timeout exceeded."
]
returns = "Final task object and outcome flag"

[action:idrac.delljob.get]
purpose = "Fetch Dell OEM Job status by ID (if used)"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Dell/Managers/iDRAC.Embedded.1/Jobs/<job-id>"
returns = {
  "JobState": "Scheduled|Running|Completed|Failed",
  "PercentComplete": "0–100",
  "Message": "Details of failure if any"
}
usage = "Some iDRAC firmware builds expose jobs via this OEM endpoint instead of or in addition to generic TaskService."

# =====================================================
# 5. DELL iDRAC – POWER / RESET / MANAGER
# =====================================================

[action:idrac.system.reset.graceful]
purpose = "Gracefully reboot ESXi host via iDRAC ComputerSystem.Reset"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
headers = { "Content-Type": "application/json" }
body_example = { "ResetType": "GracefulRestart" }
success_condition = "HTTP 200/202 and host begins reboot"
notes = "Assumes ESXi is responsive; use during maintenance mode."

[action:idrac.system.reset.force]
purpose = "Forcefully power cycle the host if graceful reset is not possible"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
body_example = { "ResetType": "ForceRestart" }
warning = "May cause unclean shutdown; only use if graceful reset fails."

[action:idrac.system.power_state.get]
purpose = "Check current power state of the host"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1"
returns = { "PowerState": "On|Off|PoweringOn|PoweringOff" }
usage = "Used by workflows to wait for shutdown and full boot."

[action:idrac.manager.reset]
purpose = "Reboot the iDRAC management controller (Manager.Reset)"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Manager.Reset"
body_example = { "ResetType": "GracefulRestart" }
usage = "Primarily used after iDRAC firmware updates, not for BIOS/device firmware."

# =====================================================
# 6. DELL iDRAC – VIRTUAL MEDIA & CONSOLE-RELATED
# =====================================================

[action:idrac.virtualmedia.insert]
purpose = "Mount an ISO via iDRAC virtual media (CD)"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.InsertMedia"
headers = { "Content-Type": "application/json" }
body_example = { "Image": "http://repo.example.com/isos/firmware.iso" }
success_condition = "HTTP 204 No Content"
usage = "Boot host into special ISO if needed; not used in standard REST firmware workflow."

[action:idrac.virtualmedia.eject]
purpose = "Eject currently mounted virtual media"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.EjectMedia"
body_example = {}
success_condition = "HTTP 204"

[action:idrac.virtualmedia.status]
purpose = "Check whether an ISO is currently inserted"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD"
returns = {
  "Inserted": "true|false",
  "Image": "URL of mounted ISO if any"
}

[action:idrac.console.link.generate]
purpose = "Provide a URL or hint for opening the iDRAC remote console"
implementation_note = [
  "No standard Redfish call launches the graphical console.",
  "This action should build a web URL pointing to the iDRAC HTML5 console page.",
  "e.g. https://<idrac>/#/serverConsole or vendor-specific path."
]
returns = "Console URL to present to the operator"
usage = "For human-in-the-loop workflows; not automated by REST."

# =====================================================
# 7. DELL iDRAC – SERVER CONFIGURATION PROFILE (SCP)
# =====================================================

[action:idrac.scp.export]
purpose = "Export full Server Configuration Profile (BIOS/iDRAC/RAID/NIC) to a network share"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
headers = { "Content-Type": "application/json" }
body_example = {
  "ExportFormat": "XML",
  "ShareParameters": {
    "Target": "ALL",
    "IPAddress": "<share-ip>",
    "ShareName": "<share-name>",
    "ShareType": "CIFS",
    "FileName": "<server>-config.xml",
    "Username": "<share-user>",
    "Password": "<share-pass>"
  },
  "IncludeInExport": "Default"
}
returns = "HTTP 202 and job/task ID"
usage = [
  "Take backup of configuration before BIOS/firmware runs.",
  "Can be used for disaster recovery if settings are lost."
]

[action:idrac.scp.import.preview]
purpose = "Validate an SCP file import without applying"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration"
body_example = {
  "ImportBuffer": "",
  "ShareParameters": {
    "IPAddress": "<share-ip>",
    "ShareName": "<share-name>",
    "ShareType": "CIFS",
    "FileName": "<server>-config.xml",
    "Username": "<share-user>",
    "Password": "<share-pass>"
  },
  "ShutdownType": "Graceful",
  "ImportSystemConfigurationPreview": "True"
}
usage = "Optional safety check; not required for basic update flow."

[action:idrac.scp.import.apply]
purpose = "Apply SCP file to restore configuration"
method = "POST"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ImportSystemConfiguration"
body_example = {
  "ImportBuffer": "",
  "ShareParameters": {
    "IPAddress": "<share-ip>",
    "ShareName": "<share-name>",
    "ShareType": "CIFS",
    "FileName": "<server>-config.xml",
    "Username": "<share-user>",
    "Password": "<share-pass>"
  },
  "ShutdownType": "Graceful",
  "ImportSystemConfigurationPreview": "False"
}
warning = "May reboot host and change BIOS/storage/network settings."

# =====================================================
# 8. DELL iDRAC – BIOS SETTINGS & LOGS
# =====================================================

[action:idrac.bios.settings.get]
purpose = "Retrieve current BIOS attribute set"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1/Bios"
returns = "Attributes map of BIOS settings"
usage = "Diagnostics or advanced automation; not required for simple firmware updates."

[action:idrac.bios.settings.patch]
purpose = "Change one or more BIOS attributes"
method = "PATCH"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1/Bios/Settings"
headers = { "Content-Type": "application/json" }
body_example = {
  "Attributes": {
    "BootMode": "Uefi",
    "SriovGlobalEnable": "Enabled"
  }
}
requires = "Reboot via idrac.system.reset.graceful to apply"
warning = "Use carefully; BIOS changes can affect boot behaviour."

[action:idrac.logs.lifecycle.list]
purpose = "Read Lifecycle Log entries (hardware + config events)"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Managers/iDRAC.Embedded.1/LogServices/Lclog/Entries"
returns = "Array of recent lifecycle events"
usage = "Check for failures or warnings during update."

[action:idrac.logs.systemevent.list]
purpose = "Read System Event Log entries"
method = "GET"
url_template = "https://<idrac>/redfish/v1/Systems/System.Embedded.1/LogServices/SystemEvent/Entries"
usage = "Additional health signal used by post-update verification."

# =====================================================
# 9. VMWARE VCENTER – AUTH & INVENTORY
# =====================================================

[action:vcenter.auth.login]
purpose = "Log into vCenter REST API and obtain session token"
method = "POST"
url_template = "https://<vcenter>/api/session"
auth = "HTTP Basic (e.g. administrator@vsphere.local + password)"
returns = { "token": "<session-id>" }
success_condition = "HTTP 200 with token string in body"
usage = "Set header vmware-api-session-id: <token> for subsequent calls."

[action:vcenter.auth.logout]
purpose = "Invalidate current session token"
method = "DELETE"
url_template = "https://<vcenter>/api/session"
headers = { "vmware-api-session-id": "<token>" }
success_condition = "HTTP 200/204"

[action:vcenter.cluster.list]
purpose = "List all clusters in vCenter"
method = "GET"
url_template = "https://<vcenter>/api/vcenter/cluster"
returns = "Array of clusters with 'cluster' ID and 'name' fields"

[action:vcenter.host.list_all]
purpose = "List all ESXi hosts"
method = "GET"
url_template = "https://<vcenter>/api/vcenter/host"
returns = "Array of hosts: { 'host': 'host-1234', 'name': 'esx01', 'connection_state': 'CONNECTED', ... }"

[action:vcenter.host.list_by_cluster]
purpose = "List ESXi hosts belonging to a specific cluster"
method = "GET"
url_template = "https://<vcenter>/api/vcenter/host?filter.clusters=<cluster-id>"
returns = "Array of host objects scoped to the given cluster"
notes = "Exact filter syntax may vary slightly by vSphere version; adapt client accordingly."

[action:vcenter.host.get]
purpose = "Get detailed info for a specific host"
method = "GET"
url_template = "https://<vcenter>/api/vcenter/host/<host-id>"
returns = {
  "name": "Hostname",
  "connection_state": "CONNECTED|DISCONNECTED|NOT_RESPONDING",
  "power_state": "POWERED_ON|POWERED_OFF",
  "...": "Other host details as exposed by API"
}

# =====================================================
# 10. VMWARE VCENTER – MAINTENANCE & HOST STATE
# =====================================================

[action:vcenter.host.maintenance.enter]
purpose = "Request host to enter maintenance mode"
method = "POST"
url_template = "https://<vcenter>/api/vcenter/host/maintenance/requests"
headers = {
  "vmware-api-session-id": "<token>",
  "Content-Type": "application/json"
}
body_example = {
  "host": "<host-id>",
  "mode": "ENTER"
}
returns = {
  "request_id": "<maintenance-request-id>",
  "status": "IN_PROGRESS|COMPLETED|FAILED (depending on API version)"
}
success_condition = "HTTP 200/202 and maintenance request accepted"
notes = [
  "If VMs cannot be evacuated, this may fail or block.",
  "Agent should optionally check VM list and act accordingly."
]

[action:vcenter.host.maintenance.exit]
purpose = "Exit maintenance mode for a host"
method = "DELETE_or_POST"
url_template = "https://<vcenter>/api/vcenter/host/maintenance/requests/<request-id>"
notes = [
  "Exact verb and URL may differ by vSphere version.",
  "If REST is insufficient, a non-REST integration (PowerCLI/pyVmomi) may be required.",
  "This action represents the logical step to exit maintenance mode."
]

[action:vcenter.host.state.wait]
purpose = "Poll host until it reaches desired connection/power state"
inputs = {
  "host_id": "<host-id>",
  "desired_connection_state": "CONNECTED",
  "desired_power_state": "POWERED_ON",
  "timeout_seconds": 1800,
  "poll_interval_seconds": 15
}
implementation_hint = [
  "Loop GET /api/vcenter/host/<host-id>.",
  "Check connection_state and power_state.",
  "Stop when both match desired values or timeout."
]
returns = "Final host object and outcome flag."

# =====================================================
# 11. VMWARE VCENTER – VM OPERATIONS (OPTIONAL)
# =====================================================

[action:vcenter.vm.list_on_host]
purpose = "List VMs currently registered on a specific host"
method = "GET"
url_template = "https://<vcenter>/api/vcenter/vm?filter.host=<host-id>"
returns = "Array of VM summaries"

[action:vcenter.vm.power.stop]
purpose = "Gracefully power off a VM"
method = "POST"
url_template = "https://<vcenter>/api/vcenter/vm/<vm-id>/power/stop"
headers = { "Content-Type": "application/json" }
body_example = { "spec": { "type": "SOFT" } }
notes = "Exact body may vary; some versions accept an empty POST with default power-off behaviour."

[action:vcenter.vm.power.start]
purpose = "Power on a VM"
method = "POST"
url_template = "https://<vcenter>/api/vcenter/vm/<vm-id>/power/start"

[action:vcenter.vm.migrate.placeholder]
purpose = "Placeholder for VM vMotion operations"
notes = [
  "VM migration can be triggered via other VMware APIs (vSphere SOAP/pyVmomi/PowerCLI).",
  "In many environments, entering maintenance will automatically evacuate VMs via DRS.",
  "This action is documented for completeness but may map to non-REST integrations."
]

# =====================================================
# 12. CLUSTER SAFETY & CAPACITY CHECKS
# =====================================================

[action:cluster.safety.check_before_update]
purpose = "Ensure it is safe to take one host in a cluster out for maintenance"
inputs = {
  "cluster_id": "<cluster-id>",
  "host_to_maintenance": "<host-id>",
  "min_remaining_hosts": 2
}
logic = [
  "Count total hosts in cluster.",
  "Check how many are healthy (CONNECTED, POWERED_ON, not in maintenance).",
  "Ensure total_healthy_minus_target >= min_remaining_hosts.",
  "Optionally check vCPU/RAM headroom using external capacity data."
]
returns = {
  "safe_to_proceed": "true|false",
  "reason": "Text explanation if false"
}

# =====================================================
# 13. HIGH-LEVEL WORKFLOWS – HOST
# =====================================================

[action:workflow.host.prepare_for_update]
purpose = "Prepare a single ESXi host for firmware updates"
inputs = {
  "host_id": "<host-id>",
  "idrac_host": "<idrac>",
  "backup_scp": "true|false"
}
steps = [
  "Call vcenter.host.maintenance.enter for host_id.",
  "Wait until host in maintenance (may require checking maintenance-specific APIs or absence of running VMs).",
  "Call idrac.system.info to confirm connectivity.",
  "If backup_scp is true: call idrac.scp.export and wait for completion with idrac.task.wait_for_state."
]
success_condition = "Host is in maintenance mode and (optionally) SCP backup completed."
failure_strategy = [
  "If entering maintenance fails, abort and alert.",
  "If SCP export fails, decide based on policy: abort or continue."
]

[action:workflow.host.apply_firmware]
purpose = "Apply one or more firmware packages to a host via iDRAC"
inputs = {
  "idrac_host": "<idrac>",
  "update_mode": "simple|upload",
  "image_uri_list": ["https://repo/.../bios.exe", "https://repo/.../idrac.exe"],
  "local_package_refs": ["optional IDs if using staged uploads"],
  "reboot_policy": "auto_if_required|always_after|manual"
}
steps = [
  "For each firmware item in desired order:",
  "  If update_mode == 'simple': call idrac.update.simple with ImageURI.",
  "  Else if update_mode == 'upload': call idrac.update.upload_stage then idrac.update.apply_staged.",
  "  For each update job, call idrac.task.wait_for_state until Completed or failure.",
  "After all updates, if reboot_policy requires reboot and updates did not auto-reboot:",
  "  Call idrac.system.reset.graceful.",
  "  Poll idrac.system.power_state.get until PowerState cycles Off->On.",
  "  Optionally also call vcenter.host.state.wait to confirm host reconnected."
]
success_condition = "All firmware tasks Completed and host is powered back on."
failure_strategy = [
  "On any firmware job failure, stop further updates for this host.",
  "Record failure and alert; do not move to next host automatically unless policy allows."
]

[action:workflow.host.post_update_verify]
purpose = "Verify health and configuration after firmware updates"
inputs = {
  "host_id": "<host-id>",
  "idrac_host": "<idrac>"
}
steps = [
  "Call idrac.firmware.inventory.list and capture final versions.",
  "Call idrac.system.info and check Status.HealthRollup == 'OK'.",
  "Call idrac.logs.lifecycle.list and idrac.logs.systemevent.list; scan for new Critical/Warning entries.",
  "Call vcenter.host.get and verify connection_state == 'CONNECTED' and power_state == 'POWERED_ON'."
]
success_condition = "All checks normal; no new critical hardware events."
failure_strategy = [
  "If health is not OK, keep host in maintenance and escalate.",
  "Optionally compare previous vs current firmware versions for reporting."
]

[action:workflow.host.return_to_service]
purpose = "Exit maintenance mode and return host to production use"
inputs = {
  "host_id": "<host-id>",
  "maintenance_request_id": "<request-id-if-required>"
}
steps = [
  "Call vcenter.host.maintenance.exit (using maintenance_request_id or appropriate API).",
  "Call vcenter.host.state.wait until connection_state == 'CONNECTED'."
]
success_condition = "Host is no longer in maintenance, ready to run VMs."

[action:workflow.host.full_update_cycle]
purpose = "End-to-end firmware update cycle for a single ESXi host"
inputs = {
  "cluster_id": "<cluster-id>",
  "host_id": "<host-id>",
  "idrac_host": "<idrac>",
  "backup_scp": "true|false",
  "update_mode": "simple|upload",
  "image_uri_list": ["..."],
  "reboot_policy": "auto_if_required|always_after|manual"
}
steps = [
  "Call cluster.safety.check_before_update to ensure N-1 safety.",
  "Call workflow.host.prepare_for_update.",
  "Call workflow.host.apply_firmware.",
  "Call workflow.host.post_update_verify.",
  "If verification succeeds: call workflow.host.return_to_service.",
  "If verification fails: keep host in maintenance and alert."
]
success_condition = "Host updated, verified healthy, and back in service."
failure_strategy = "Stop sequence and do NOT proceed to next host until operator review."

# =====================================================
# 14. HIGH-LEVEL WORKFLOWS – CLUSTER / GROUP
# =====================================================

[action:workflow.cluster.update_sequential]
purpose = "Sequentially update all hosts in a given vSphere cluster"
inputs = {
  "cluster_id": "<cluster-id>",
  "update_plan": {
    "update_mode": "simple|upload",
    "image_uri_list": ["..."],
    "reboot_policy": "auto_if_required|always_after|manual",
    "backup_scp": "true|false"
  }
}
steps = [
  "Use env.cluster_host_list.resolve to get ordered host list for cluster_id.",
  "For each host in list:",
  "  Resolve idrac_host via env.host_idrac_map.get.",
  "  Call workflow.host.full_update_cycle for that host with update_plan.",
  "  If host update fails, stop loop and flag cluster as partially updated."
]
success_condition = "All hosts in cluster updated successfully, one at a time."
failure_strategy = [
  "On first host failure, halt sequence and require manual intervention.",
  "Optionally support 'best-effort' mode where failures are logged and flow continues – but default should be safe halt."
]

[action:workflow.multicluster.update_group]
purpose = "Update firmware across a group of clusters in sequence"
inputs = {
  "cluster_id_list": ["cluster-1", "cluster-2", "..."],
  "update_plan": "Same structure as workflow.cluster.update_sequential.update_plan"
}
steps = [
  "For each cluster_id in cluster_id_list:",
  "  Call workflow.cluster.update_sequential.",
  "  If a cluster fails, decide policy: stop group or continue to next cluster."
]
usage = "Used by the scheduler when applying global firmware waves (e.g., per site or per environment)."

# =====================================================
# 15. REPORTING & AUDIT
# =====================================================

[action:reporting.capture_host_update_result]
purpose = "Persist outcome of a host update cycle for reporting"
inputs = {
  "cluster_id": "<cluster-id>",
  "host_id": "<host-id>",
  "idrac_host": "<idrac>",
  "service_tag": "<service-tag>",
  "start_time": "<timestamp>",
  "end_time": "<timestamp>",
  "status": "SUCCESS|FAILED|PARTIAL",
  "firmware_before": "Map of component->version",
  "firmware_after": "Map of component->version",
  "error_messages": ["..."]
}
storage = "Application DB or log; not a remote API."
usage = [
  "Used to build dashboards, audit history, and CSV/HTML reports.",
  "LLM can call this at the end of workflow.host.full_update_cycle."
]

[action:reporting.generate_cluster_summary]
purpose = "Produce a human/LLM readable summary for a cluster update run"
inputs = {
  "cluster_id": "<cluster-id>",
  "time_range": "Start/end timestamps"
}
returns = {
  "total_hosts": 0,
  "success_count": 0,
  "failure_count": 0,
  "per_host_results": [
    {
      "host_name": "esx01",
      "status": "SUCCESS",
      "bios_version_before": "x.y.z",
      "bios_version_after": "a.b.c"
    }
  ]
}
usage = "Power summary views in Lovable LLM UI or external dashboards."

