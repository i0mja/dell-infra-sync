import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, HardDrive, Shield, Zap } from "lucide-react";

interface ConfigurationTabProps {
  window: any;
}

export function ConfigurationTab({ window }: ConfigurationTabProps) {
  const details = window.details || {};

  return (
    <div className="space-y-4">
      {window.maintenance_type === 'firmware_only' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="w-4 h-4" />
              Firmware Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Firmware Source</div>
              <Badge variant="outline" className="capitalize">
                {details.firmware_source === 'dell_catalog' 
                  ? 'Dell Online Catalog' 
                  : details.firmware_source === 'manual_packages'
                  ? 'Manual Packages'
                  : 'Not configured'}
              </Badge>
            </div>

            {details.component_filter && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Component Filter</div>
                <p className="text-sm">{details.component_filter}</p>
              </div>
            )}

            <div>
              <div className="text-sm text-muted-foreground mb-1">Auto-select Latest</div>
              <Badge variant={details.auto_select_latest ? "default" : "outline"}>
                {details.auto_select_latest ? 'Yes' : 'No'}
              </Badge>
            </div>

            {details.dell_catalog_url && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Catalog URL</div>
                <p className="text-xs font-mono break-all">{details.dell_catalog_url}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {window.maintenance_type === 'esxi_upgrade' && details.esxi_profile_id && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="w-4 h-4" />
              ESXi Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Profile ID</div>
              <p className="text-sm font-mono">{details.esxi_profile_id}</p>
            </div>

            {details.esxi_credential_mode && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Credential Mode</div>
                <Badge variant="outline">{details.esxi_credential_mode}</Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Execution Options
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {details.max_parallel !== undefined && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Max Parallel Updates</div>
              <Badge variant="outline">{details.max_parallel}</Badge>
            </div>
          )}

          {details.min_healthy_hosts !== undefined && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Min Healthy Hosts Required</div>
              <Badge variant="outline">{details.min_healthy_hosts}</Badge>
            </div>
          )}

          <div className="flex gap-4">
            {details.verify_after_each !== undefined && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Verify After Each Update</div>
                <Badge variant={details.verify_after_each ? "default" : "outline"}>
                  {details.verify_after_each ? 'Yes' : 'No'}
                </Badge>
              </div>
            )}

            {details.continue_on_failure !== undefined && (
              <div>
                <div className="text-sm text-muted-foreground mb-1">Continue on Failure</div>
                <Badge variant={details.continue_on_failure ? "default" : "outline"}>
                  {details.continue_on_failure ? 'Yes' : 'No'}
                </Badge>
              </div>
            )}
          </div>

          {details.reboot_servers !== undefined && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Reboot Servers</div>
              <Badge variant={details.reboot_servers ? "default" : "outline"}>
                {details.reboot_servers ? 'Yes' : 'No'}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Backup Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <div className="text-sm text-muted-foreground mb-1">SCP Backup Before Update</div>
            <Badge variant={details.backup_scp ? "default" : "outline"}>
              {details.backup_scp ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>

          {details.backup_components && (
            <div>
              <div className="text-sm text-muted-foreground mb-1">Backup Components</div>
              <div className="flex gap-2 flex-wrap">
                {details.backup_components.includes('bios') && (
                  <Badge variant="outline">BIOS</Badge>
                )}
                {details.backup_components.includes('idrac') && (
                  <Badge variant="outline">iDRAC</Badge>
                )}
                {details.backup_components.includes('nic') && (
                  <Badge variant="outline">NIC</Badge>
                )}
                {details.backup_components.includes('raid') && (
                  <Badge variant="outline">RAID</Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {window.credential_set_ids && window.credential_set_ids.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credentials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-1">Credential Sets</div>
            <Badge variant="outline">
              {window.credential_set_ids.length} credential set(s) configured
            </Badge>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
