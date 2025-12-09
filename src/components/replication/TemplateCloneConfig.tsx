/**
 * TemplateCloneConfig
 * 
 * Sub-component for OnboardZfsTargetWizard that appears when a template is selected.
 * Provides configuration for cloning the template with guest customization.
 */

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { 
  Copy, 
  ChevronDown, 
  AlertTriangle,
  Server,
  Network,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface CloneSettings {
  cloneName: string;
  targetDatastore: string;
  targetCluster: string;
  useGuestCustomization: boolean;
  clearMachineId: boolean;
  clearSshHostKeys: boolean;
  useStaticIp: boolean;
  staticIp: string;
  staticNetmask: string;
  staticGateway: string;
  staticDns: string;
}

interface TemplateCloneConfigProps {
  templateName: string;
  targetName: string;
  settings: CloneSettings;
  onSettingsChange: (settings: CloneSettings) => void;
  datastores: Array<{ name: string; freeSpace?: number }>;
  clusters: Array<{ name: string }>;
  isLoading?: boolean;
}

export function TemplateCloneConfig({
  templateName,
  targetName,
  settings,
  onSettingsChange,
  datastores,
  clusters,
  isLoading = false,
}: TemplateCloneConfigProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Auto-generate clone name from target name
  useEffect(() => {
    if (targetName && !settings.cloneName) {
      onSettingsChange({
        ...settings,
        cloneName: `${targetName}-${Date.now().toString(36).slice(-4)}`,
      });
    }
  }, [targetName]);
  
  const updateSettings = (updates: Partial<CloneSettings>) => {
    onSettingsChange({ ...settings, ...updates });
  };
  
  return (
    <div className="space-y-4">
      <Alert className="border-blue-500/50 bg-blue-500/5">
        <Copy className="h-4 w-4 text-blue-500" />
        <AlertDescription className="text-sm">
          <span className="font-medium">Template Selected</span>
          <p className="mt-1 text-muted-foreground">
            This is a VMware template. The wizard will clone it to a new VM, apply guest customization, 
            power it on, then configure ZFS/NFS. The original template remains unchanged.
          </p>
        </AlertDescription>
      </Alert>
      
      <div className="p-4 rounded-lg border bg-card space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Server className="h-4 w-4" />
          Clone Configuration
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Clone VM Name</Label>
            <Input
              value={settings.cloneName}
              onChange={(e) => updateSettings({ cloneName: e.target.value })}
              placeholder="zfs-target-01"
            />
          </div>
          
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Target Cluster</Label>
            <Select 
              value={settings.targetCluster} 
              onValueChange={(v) => updateSettings({ targetCluster: v })}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading..." : "Select cluster"} />
              </SelectTrigger>
              <SelectContent>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster.name} value={cluster.name}>
                    {cluster.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Target Datastore</Label>
          <Select 
            value={settings.targetDatastore} 
            onValueChange={(v) => updateSettings({ targetDatastore: v })}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder={isLoading ? "Loading..." : "Select datastore"} />
            </SelectTrigger>
            <SelectContent>
              {datastores.map((ds) => (
                <SelectItem key={ds.name} value={ds.name}>
                  <div className="flex items-center justify-between w-full">
                    <span>{ds.name}</span>
                    {ds.freeSpace && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {Math.round(ds.freeSpace / 1024 / 1024 / 1024)} GB free
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Guest Customization */}
      <div className="p-4 rounded-lg border bg-card space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Network className="h-4 w-4" />
            Guest Customization
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="use-customization"
              checked={settings.useGuestCustomization}
              onCheckedChange={(checked) => updateSettings({ useGuestCustomization: !!checked })}
            />
            <Label htmlFor="use-customization" className="text-xs">Enable</Label>
          </div>
        </div>
        
        {settings.useGuestCustomization && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="clear-machine-id"
                  checked={settings.clearMachineId}
                  onCheckedChange={(checked) => updateSettings({ clearMachineId: !!checked })}
                />
                <Label htmlFor="clear-machine-id" className="text-sm">
                  Clear machine-id
                </Label>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="clear-ssh-keys"
                  checked={settings.clearSshHostKeys}
                  onCheckedChange={(checked) => updateSettings({ clearSshHostKeys: !!checked })}
                />
                <Label htmlFor="clear-ssh-keys" className="text-sm">
                  Regenerate SSH host keys
                </Label>
              </div>
            </div>
            
            <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                Static IP Configuration
              </CollapsibleTrigger>
              
              <CollapsibleContent className="pt-3 space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="use-static-ip"
                    checked={settings.useStaticIp}
                    onCheckedChange={(checked) => updateSettings({ useStaticIp: !!checked })}
                  />
                  <Label htmlFor="use-static-ip" className="text-sm">
                    Use static IP (instead of DHCP)
                  </Label>
                </div>
                
                {settings.useStaticIp && (
                  <div className="grid grid-cols-2 gap-3 pl-6">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">IP Address</Label>
                      <Input
                        value={settings.staticIp}
                        onChange={(e) => updateSettings({ staticIp: e.target.value })}
                        placeholder="192.168.1.100"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Netmask</Label>
                      <Input
                        value={settings.staticNetmask}
                        onChange={(e) => updateSettings({ staticNetmask: e.target.value })}
                        placeholder="255.255.255.0"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Gateway</Label>
                      <Input
                        value={settings.staticGateway}
                        onChange={(e) => updateSettings({ staticGateway: e.target.value })}
                        placeholder="192.168.1.1"
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">DNS Server</Label>
                      <Input
                        value={settings.staticDns}
                        onChange={(e) => updateSettings({ staticDns: e.target.value })}
                        placeholder="8.8.8.8"
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}
      </div>
      
      {!settings.targetCluster && (
        <Alert variant="destructive" className="border-orange-500/50 bg-orange-500/5">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <AlertDescription className="text-sm text-orange-600">
            Please select a target cluster for the cloned VM
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
