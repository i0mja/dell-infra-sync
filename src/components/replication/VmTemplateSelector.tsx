/**
 * VM Template Selector Dialog
 * 
 * Allows users to browse and select VM templates from synced vCenter inventory.
 * Filters for powered-off VMs or those with "template" in their name.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Server,
  Monitor,
  PowerOff,
  CheckCircle2,
  FileBox,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

interface VCenterTemplate {
  id: string;
  name: string;
  vcenter_id: string | null;
  cluster_name: string | null;
  power_state: string | null;
  guest_os: string | null;
  disk_gb: number | null;
  memory_mb: number | null;
  cpu_count: number | null;
}

interface VmTemplateSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceVCenterId: string;
  onSelect: (template: { 
    moref: string; 
    name: string; 
    cluster?: string;
    cpu_count?: number;
    memory_mb?: number;
    disk_gb?: number;
    guest_os?: string;
  }) => void;
}

export function VmTemplateSelector({
  open,
  onOpenChange,
  sourceVCenterId,
  onSelect,
}: VmTemplateSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [clusterFilter, setClusterFilter] = useState<string>("all");
  const [selectedTemplate, setSelectedTemplate] = useState<VCenterTemplate | null>(null);

  // Fetch VMs that look like templates (powered off or name contains "template")
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["vcenter-templates", sourceVCenterId],
    queryFn: async () => {
      if (!sourceVCenterId) return [];
      
      const { data, error } = await supabase
        .from("vcenter_vms")
        .select("id, name, vcenter_id, cluster_name, power_state, guest_os, disk_gb, memory_mb, cpu_count")
        .eq("source_vcenter_id", sourceVCenterId)
        .or("is_template.eq.true,power_state.eq.template,power_state.eq.poweredOff,name.ilike.%template%")
        .order("name");

      if (error) throw error;
      return data as VCenterTemplate[];
    },
    enabled: open && !!sourceVCenterId,
  });

  // Get unique clusters for filter
  const clusters = useMemo(() => {
    const clusterSet = new Set(templates.map(t => t.cluster_name).filter(Boolean));
    return Array.from(clusterSet).sort();
  }, [templates]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter(template => {
      // Search filter
      if (searchTerm && !template.name.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Cluster filter
      if (clusterFilter !== "all" && template.cluster_name !== clusterFilter) {
        return false;
      }

      return true;
    });
  }, [templates, searchTerm, clusterFilter]);

  const handleSelect = () => {
    if (!selectedTemplate || !selectedTemplate.vcenter_id) return;

    onSelect({
      moref: selectedTemplate.vcenter_id,
      name: selectedTemplate.name,
      cluster: selectedTemplate.cluster_name || undefined,
      cpu_count: selectedTemplate.cpu_count || undefined,
      memory_mb: selectedTemplate.memory_mb || undefined,
      disk_gb: selectedTemplate.disk_gb || undefined,
      guest_os: selectedTemplate.guest_os || undefined,
    });
    handleClose();
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedTemplate(null);
    setSearchTerm("");
    setClusterFilter("all");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBox className="h-5 w-5" />
            Select VM Template
          </DialogTitle>
          <DialogDescription>
            Choose a template from your synced vCenter inventory. Showing powered-off VMs and templates.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={clusterFilter} onValueChange={setClusterFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Clusters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clusters</SelectItem>
                {clusters.map((cluster) => (
                  <SelectItem key={cluster} value={cluster!}>
                    {cluster}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Template List */}
          <ScrollArea className="h-[300px] border rounded-lg">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
                <Server className="h-12 w-12 mb-2 opacity-50" />
                <p>{templates.length === 0 ? "No templates found" : "No matching templates"}</p>
                <p className="text-sm mt-1">Templates are powered-off VMs or VMs with "template" in their name</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredTemplates.map((template) => (
                  <div
                    key={template.id}
                    className={`p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedTemplate?.id === template.id
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted/50 border border-transparent"
                    }`}
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          selectedTemplate?.id === template.id ? "border-primary" : "border-muted-foreground/30"
                        }`}>
                          {selectedTemplate?.id === template.id && (
                            <div className="w-2 h-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <Monitor className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{template.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <PowerOff className="h-3 w-3 text-muted-foreground" />
                        <Badge variant="outline" className="text-xs">
                          {template.cluster_name || "No Cluster"}
                        </Badge>
                      </div>
                    </div>
                    <div className="mt-1 ml-10 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{template.vcenter_id}</span>
                      {template.guest_os && <span>• {template.guest_os}</span>}
                      {template.cpu_count && <span>• {template.cpu_count} vCPU</span>}
                      {template.memory_mb && <span>• {Math.round(template.memory_mb / 1024)} GB</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Selection Summary */}
          {selectedTemplate && (
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-medium">Selected: {selectedTemplate.name}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                MoRef: <code className="bg-muted px-1 rounded">{selectedTemplate.vcenter_id}</code>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedTemplate || !selectedTemplate.vcenter_id}>
            Select Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
