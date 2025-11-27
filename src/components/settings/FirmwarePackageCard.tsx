import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, HardDrive, Cpu, Network, Database, AlertCircle } from "lucide-react";
import { FirmwarePackage } from "@/hooks/useFirmwarePackages";
import { format } from "date-fns";

interface FirmwarePackageCardProps {
  firmware: FirmwarePackage;
  onDelete: (id: string) => void;
}

const componentIcons: Record<string, any> = {
  BIOS: Cpu,
  iDRAC: Network,
  NIC: Network,
  RAID: Database,
  Drivers: HardDrive,
};

const criticalityColors: Record<string, string> = {
  Critical: "destructive",
  Recommended: "default",
  Optional: "secondary",
};

export function FirmwarePackageCard({ firmware, onDelete }: FirmwarePackageCardProps) {
  const ComponentIcon = componentIcons[firmware.component_type] || HardDrive;
  const fileSizeMB = (firmware.file_size_bytes / (1024 * 1024)).toFixed(2);

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-primary/10 rounded-lg">
            <ComponentIcon className="h-5 w-5 text-primary" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-sm truncate">{firmware.filename}</h3>
              {firmware.criticality && (
                <Badge variant={criticalityColors[firmware.criticality] as any} className="text-xs">
                  {firmware.criticality}
                </Badge>
              )}
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">{firmware.component_type}</span>
                <span>•</span>
                <span>Version {firmware.dell_version}</span>
                <span>•</span>
                <span>{fileSizeMB} MB</span>
              </div>
              
              {firmware.applicable_models && firmware.applicable_models.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Models: {firmware.applicable_models.join(", ")}
                </div>
              )}
              
              {firmware.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {firmware.description}
                </p>
              )}
              
              <div className="flex items-center gap-3 mt-2">
                {firmware.reboot_required && (
                  <div className="flex items-center gap-1 text-xs text-amber-600">
                    <AlertCircle className="h-3 w-3" />
                    <span>Reboot required</span>
                  </div>
                )}
                
                {firmware.release_date && (
                  <span className="text-xs text-muted-foreground">
                    Released {format(new Date(firmware.release_date), "MMM d, yyyy")}
                  </span>
                )}
                
                {firmware.use_count && firmware.use_count > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Used {firmware.use_count} times
                  </span>
                )}
              </div>
              
              {firmware.tags && firmware.tags.length > 0 && (
                <div className="flex gap-1 mt-2">
                  {firmware.tags.map((tag, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(firmware.id)}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}
