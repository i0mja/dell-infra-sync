
[action:idrac.auth.login]
purpose = "Authenticate to Dell iDRAC via Redfish Basic Auth or Session Login"
method = "POST"
endpoint = "/redfish/v1/SessionService/Sessions"
body_example = {"UserName": "<user>", "Password": "<pass>"}
returns = "Session token (X-Auth-Token) or uses HTTP Basic Auth"

[action:idrac.system.info]
purpose = "Retrieve full system information incl. health rollup"
method = "GET"
endpoint = "/redfish/v1/Systems/System.Embedded.1"
success_condition = "Returns JSON of system and Status.HealthRollup"

[action:idrac.firmware.inventory]
purpose = "Retrieve current installed firmware versions for BIOS, iDRAC, NIC, RAID, etc."
method = "GET"
endpoint = "/redfish/v1/UpdateService/FirmwareInventory"
returns = "Software/Firmware Inventory objects"

[action:idrac.update.simple]
purpose = "Stage and apply firmware via network URL"
method = "POST"
endpoint = "/redfish/v1/UpdateService/Actions/UpdateService.SimpleUpdate"
body_example = {"ImageURI": "<http/https url>", "TransferProtocol": "HTTP"}
success_condition = "HTTP 202 with Job ID"

[action:idrac.update.upload]
purpose = "Upload firmware file directly via multipart push"
method = "POST"
endpoint = "/redfish/v1/UpdateService/FirmwareInventory"
headers = {"If-Match": "<ETAG>"}
body_example = "multipart/form-data with firmware image"
success_condition = "Image available under FirmwareInventory/Available"

[action:idrac.jobs.monitor]
purpose = "Monitor Dell update job until completion"
method = "GET"
endpoint = "/redfish/v1/TaskService/Tasks/<job_id>"
success_condition = "JobState = Completed"

[action:idrac.reboot.system]
purpose = "Reboot server to apply firmware changes"
method = "POST"
endpoint = "/redfish/v1/Systems/System.Embedded.1/Actions/ComputerSystem.Reset"
body_example = {"ResetType": "GracefulRestart"}

[action:idrac.virtualmedia.insert]
purpose = "Mount ISO via iDRAC virtual media"
method = "POST"
endpoint = "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.InsertMedia"
body_example = {"Image": "<iso_url>"}

[action:idrac.virtualmedia.eject]
purpose = "Eject mounted media"
method = "POST"
endpoint = "/redfish/v1/Managers/iDRAC.Embedded.1/VirtualMedia/CD/Actions/VirtualMedia.EjectMedia"
body_example = {}

[action:idrac.scp.export]
purpose = "Export Server Configuration Profile (BIOS/iDRAC/RAID settings)"
method = "POST"
endpoint = "/redfish/v1/Managers/iDRAC.Embedded.1/Actions/Oem/EID_674_Manager.ExportSystemConfiguration"
body_example = {
   "ExportFormat": "XML",
   "ShareParameters": {
     "Target": "ALL",
     "IPAddress": "<share_ip>",
     "ShareName": "<folder>",
     "ShareType": "CIFS",
     "FileName": "<server>.xml",
     "Username": "<user>",
     "Password": "<pass>"
   }
}

# ===============================
# VMWARE VCENTER REST – ACTIONS
# ===============================

[action:vcenter.auth.login]
purpose = "Login to vCenter REST and return session token"
method = "POST"
endpoint = "/api/session"
auth = "Basic Auth"
returns = "vmware-api-session-id token"

[action:vcenter.host.list]
purpose = "List all ESXi hosts with host IDs"
method = "GET"
endpoint = "/api/vcenter/host"
returns = "Array of hosts"

[action:vcenter.cluster.list]
purpose = "List clusters"
method = "GET"
endpoint = "/api/vcenter/cluster"

[action:vcenter.host.maintenance.enter]
purpose = "Put host in maintenance mode"
method = "POST"
endpoint = "/api/vcenter/host/maintenance/requests"
body_example = {"host": "<host-id>", "mode": "ENTER"}
success_condition = "Host begins entering maintenance"

[action:vcenter.host.maintenance.exit]
purpose = "Exit maintenance mode"
method = "DELETE or POST"
endpoint = "/api/vcenter/host/maintenance/requests/<request_id>"

[action:vcenter.host.state]
purpose = "Check host connection state"
method = "GET"
endpoint = "/api/vcenter/host/<host-id>"
returns = "connection_state, power_state"

[action:vcenter.vm.list_on_host]
purpose = "List VMs running on a specific host"
method = "GET"
endpoint = "/api/vcenter/vm?filter.host=<host-id>"

[action:vcenter.vm.power.stop]
purpose = "Shutdown VM"
method = "POST"
endpoint = "/api/vcenter/vm/<vm-id>/power/stop"

# ===============================
# WORKFLOW ENGINE LOGIC (LLM)
# ===============================

[action:workflow.update_host]
purpose = "Complete update cycle for a single ESXi host"
steps = [
  "vcenter.host.maintenance.enter",
  "idrac.system.info",
  "idrac.scp.export (optional)",
  "idrac.firmware.inventory",
  "idrac.update.simple OR idrac.update.upload",
  "idrac.jobs.monitor",
  "idrac.reboot.system (if needed)",
  "wait for host reconnect",
  "vcenter.host.maintenance.exit",
  "verify health via idrac.system.info"
]

[action:workflow.update_cluster]
purpose = "Sequentially update each host in a cluster"
loop = "For each ESXi host in cluster: run workflow.update_host"

