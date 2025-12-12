import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  HardDrive, 
  Search, 
  CheckCircle2,
  Key,
  Server,
  Cpu,
  MemoryStick
} from "lucide-react";
import { useZfsTemplates, ZfsTargetTemplate } from "@/hooks/useZfsTemplates";
import { cn } from "@/lib/utils";

interface ZfsApplianceSelectorProps {
  selectedId?: string;
  onSelect: (template: ZfsTargetTemplate | null) => void;
  showOnlyReady?: boolean;
  vcenterId?: string;
}

export const ZfsApplianceSelector = ({ 
  selectedId, 
  onSelect,
  showOnlyReady = true,
  vcenterId
}: ZfsApplianceSelectorProps) => {
  const { templates, loading } = useZfsTemplates();
  const [searchQuery, setSearchQuery] = useState("");

  // Filter templates
  const filteredTemplates = templates.filter((template) => {
    const extTemplate = template as ZfsTargetTemplate & { status?: string };
    // Filter by vCenter if specified
    if (vcenterId && template.vcenter_id !== vcenterId) {
      return false;
    }
    const matchesSearch = 
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !showOnlyReady || 
      (extTemplate.status === 'ready' && template.is_active);
    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        Loading appliances...
      </div>
    );
  }

  if (filteredTemplates.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center">
          <HardDrive className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground mb-2">
            {searchQuery 
              ? "No appliances match your search" 
              : vcenterId 
                ? "No ready appliances for this vCenter"
                : "No ready appliances available"}
          </p>
          <p className="text-xs text-muted-foreground">
            Prepare a template first in Settings → Infrastructure → Appliance Library
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {templates.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search appliances..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}
      
      <ScrollArea className="max-h-[300px]">
        <div className="space-y-2 pr-4">
          {filteredTemplates.map((template) => {
            const extTemplate = template as ZfsTargetTemplate & { 
              status?: string; 
              version?: string;
              deployment_count?: number;
            };
            const isSelected = selectedId === template.id;
            
            return (
              <Card
                key={template.id}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary/50",
                  isSelected && "border-primary ring-1 ring-primary"
                )}
                onClick={() => onSelect(isSelected ? null : template)}
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0",
                      isSelected ? "bg-primary/20" : "bg-muted"
                    )}>
                      {isSelected ? (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      ) : (
                        <HardDrive className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{template.name}</span>
                        {extTemplate.version && (
                          <Badge variant="outline" className="text-xs">
                            {extTemplate.version}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Server className="h-3 w-3" />
                          {template.template_name}
                        </span>
                        <span className="flex items-center gap-1">
                          <Cpu className="h-3 w-3" />
                          {template.default_cpu_count} vCPU
                        </span>
                        <span className="flex items-center gap-1">
                          <MemoryStick className="h-3 w-3" />
                          {template.default_memory_gb} GB
                        </span>
                        {template.ssh_key_id && (
                          <span className="flex items-center gap-1 text-green-600">
                            <Key className="h-3 w-3" />
                            SSH
                          </span>
                        )}
                      </div>
                      
                      {template.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {template.description}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
