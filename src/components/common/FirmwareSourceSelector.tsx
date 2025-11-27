import { useState } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Package, Globe, SkipForward, Edit } from "lucide-react";
import { useFirmwarePackages } from "@/hooks/useFirmwarePackages";

interface FirmwareSourceSelectorProps {
  value: 'local_repository' | 'dell_online_catalog' | 'skip' | 'manual';
  onChange: (value: 'local_repository' | 'dell_online_catalog' | 'skip' | 'manual') => void;
  componentFilter: string[];
  onComponentFilterChange: (components: string[]) => void;
  autoSelectLatest: boolean;
  onAutoSelectLatestChange: (value: boolean) => void;
  showManualOption?: boolean;
  showSkipOption?: boolean;
}

const COMPONENT_TYPES = [
  { id: 'all', label: 'All Components' },
  { id: 'BIOS', label: 'BIOS' },
  { id: 'iDRAC', label: 'iDRAC' },
  { id: 'NIC', label: 'Network (NIC)' },
  { id: 'RAID', label: 'Storage (RAID)' },
  { id: 'PSU', label: 'Power Supply' },
];

export function FirmwareSourceSelector({
  value,
  onChange,
  componentFilter,
  onComponentFilterChange,
  autoSelectLatest,
  onAutoSelectLatestChange,
  showManualOption = false,
  showSkipOption = false,
}: FirmwareSourceSelectorProps) {
  const { firmwarePackages } = useFirmwarePackages();

  const handleComponentToggle = (componentId: string) => {
    if (componentId === 'all') {
      if (componentFilter.includes('all') || componentFilter.length === COMPONENT_TYPES.length - 1) {
        onComponentFilterChange([]);
      } else {
        onComponentFilterChange(['all']);
      }
    } else {
      const newFilter = componentFilter.includes(componentId)
        ? componentFilter.filter(c => c !== componentId && c !== 'all')
        : [...componentFilter.filter(c => c !== 'all'), componentId];
      
      // If all non-"all" components are selected, switch to "all"
      if (newFilter.length === COMPONENT_TYPES.length - 1) {
        onComponentFilterChange(['all']);
      } else {
        onComponentFilterChange(newFilter);
      }
    }
  };

  const availablePackages = firmwarePackages.filter(pkg => 
    pkg.upload_status === 'completed' || pkg.upload_status === 'available'
  );

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <Label>Firmware Source</Label>
        <RadioGroup value={value} onValueChange={onChange}>
          <div className="flex items-start space-x-2 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
            <RadioGroupItem value="local_repository" id="local_repository" className="mt-0.5" />
            <div className="flex-1">
              <label htmlFor="local_repository" className="flex items-center gap-2 font-medium cursor-pointer">
                <Package className="h-4 w-4" />
                Local Repository
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Use firmware from your uploaded DUP library (air-gapped safe)
              </p>
              {value === 'local_repository' && (
                <Alert className="mt-2">
                  <AlertDescription>
                    {availablePackages.length > 0 
                      ? `${availablePackages.length} firmware package${availablePackages.length === 1 ? '' : 's'} available`
                      : 'No firmware packages available. Upload DUPs in Settings → Firmware Library'}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>

          <div className="flex items-start space-x-2 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
            <RadioGroupItem value="dell_online_catalog" id="dell_online_catalog" className="mt-0.5" />
            <div className="flex-1">
              <label htmlFor="dell_online_catalog" className="flex items-center gap-2 font-medium cursor-pointer">
                <Globe className="h-4 w-4" />
                Dell Online Catalog
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                Auto-fetch latest firmware from Dell (requires internet access)
              </p>
              {value === 'dell_online_catalog' && (
                <Alert variant="destructive" className="mt-2">
                  <AlertDescription>
                    Servers must have internet access to downloads.dell.com
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </div>

          {showSkipOption && (
            <div className="flex items-start space-x-2 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="skip" id="skip" className="mt-0.5" />
              <div className="flex-1">
                <label htmlFor="skip" className="flex items-center gap-2 font-medium cursor-pointer">
                  <SkipForward className="h-4 w-4" />
                  Skip Firmware Updates
                </label>
                <p className="text-sm text-muted-foreground mt-1">
                  Only perform safety checks, no firmware updates
                </p>
              </div>
            </div>
          )}

          {showManualOption && (
            <div className="flex items-start space-x-2 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
              <RadioGroupItem value="manual" id="manual" className="mt-0.5" />
              <div className="flex-1">
                <label htmlFor="manual" className="flex items-center gap-2 font-medium cursor-pointer">
                  <Edit className="h-4 w-4" />
                  Manual Entry
                </label>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter firmware URLs manually (legacy mode)
                </p>
              </div>
            </div>
          )}
        </RadioGroup>
      </div>

      {value !== 'skip' && value !== 'manual' && (
        <>
          <div className="space-y-3">
            <Label>Component Filter</Label>
            <div className="space-y-2 rounded-lg border p-3">
              {COMPONENT_TYPES.map((component) => (
                <div key={component.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`component-${component.id}`}
                    checked={
                      componentFilter.includes('all') ||
                      (component.id === 'all' && componentFilter.length === COMPONENT_TYPES.length - 1) ||
                      componentFilter.includes(component.id)
                    }
                    onCheckedChange={() => handleComponentToggle(component.id)}
                  />
                  <label
                    htmlFor={`component-${component.id}`}
                    className="text-sm font-medium cursor-pointer"
                  >
                    {component.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {value === 'dell_online_catalog' && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="auto-select">Auto-select Latest</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically choose the latest version from Dell catalog
                </p>
              </div>
              <Switch
                id="auto-select"
                checked={autoSelectLatest}
                onCheckedChange={onAutoSelectLatestChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
