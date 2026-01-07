/**
 * Protection Group Selector for Dynamic Disk Sizing
 * 
 * Allows selecting a protection group and displays VM count + storage totals.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, Server, HardDrive } from "lucide-react";
import { useProtectionGroupStorage, ProtectionGroupStorage } from "@/hooks/useProtectionGroupStorage";
import { formatBytes } from "@/utils/diskSizing";

interface ProtectionGroupSelectorProps {
  selectedId: string | undefined;
  onSelect: (group: ProtectionGroupStorage | null) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}

export function ProtectionGroupSelector({
  selectedId,
  onSelect,
  disabled = false,
  label = "Protection Group",
  placeholder = "Select protection group for sizing...",
}: ProtectionGroupSelectorProps) {
  const { data: groups = [], isLoading, error } = useProtectionGroupStorage();

  const handleValueChange = (value: string) => {
    if (value === '__none__') {
      onSelect(null);
      return;
    }
    const group = groups.find(g => g.id === value);
    onSelect(group || null);
  };

  const selectedGroup = groups.find(g => g.id === selectedId);

  return (
    <div className="space-y-2">
      <Label className="text-xs flex items-center gap-1">
        <ShieldCheck className="h-3 w-3" />
        {label}
      </Label>
      
      <Select 
        value={selectedId || '__none__'} 
        onValueChange={handleValueChange}
        disabled={disabled || isLoading}
      >
        <SelectTrigger className="h-9">
          {isLoading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </span>
          ) : (
            <SelectValue placeholder={placeholder} />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">
            <span className="text-muted-foreground italic">
              Manual sizing (no protection group)
            </span>
          </SelectItem>
          {groups.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{group.name}</span>
                <Badge variant="secondary" className="text-xs">
                  <Server className="h-2.5 w-2.5 mr-1" />
                  {group.vmCount}
                </Badge>
                <Badge variant="outline" className="text-xs font-mono">
                  <HardDrive className="h-2.5 w-2.5 mr-1" />
                  {formatBytes(group.totalStorageBytes)}
                </Badge>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && (
        <p className="text-xs text-destructive">
          Failed to load protection groups
        </p>
      )}

      {selectedGroup && selectedGroup.vmCount === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          This protection group has no VMs. Disk size will use minimum default.
        </p>
      )}
    </div>
  );
}
