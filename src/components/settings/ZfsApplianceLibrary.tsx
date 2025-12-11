import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Grid3x3, List, Plus, Search, HardDrive } from "lucide-react";
import { useZfsTemplates } from "@/hooks/useZfsTemplates";
import { ZfsApplianceCard } from "./ZfsApplianceCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PrepareTemplateWizard } from "@/components/replication/PrepareTemplateWizard";

interface ZfsApplianceLibraryProps {
  onSelectAppliance?: (template: any) => void;
}

export const ZfsApplianceLibrary = ({ onSelectAppliance }: ZfsApplianceLibraryProps) => {
  const { templates, loading, deleteTemplate, toggleActive } = useZfsTemplates();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState("");
  const [showPrepareWizard, setShowPrepareWizard] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);

  // Filter templates by search and status
  const filteredTemplates = templates.filter((template) => {
    const matchesSearch = 
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.template_name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus.length === 0 || 
      selectedStatus.includes((template as any).status || 'draft');
    return matchesSearch && matchesStatus;
  });

  // Get counts by status
  const statusCounts = templates.reduce((acc, t) => {
    const status = (t as any).status || 'draft';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const readyCount = statusCounts['ready'] || 0;
  const totalCount = templates.length;

  const handleSelect = (template: any) => {
    if (onSelectAppliance) {
      onSelectAppliance(template);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteTemplate(id);
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await toggleActive({ id, is_active: isActive });
  };

  const statusOptions = [
    { value: 'draft', label: 'Draft', color: 'bg-muted' },
    { value: 'preparing', label: 'Preparing', color: 'bg-blue-500' },
    { value: 'ready', label: 'Ready', color: 'bg-green-500' },
    { value: 'deprecated', label: 'Deprecated', color: 'bg-orange-500' },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HardDrive className="h-4 w-4" />
            <span>{readyCount} ready</span>
            <span className="text-muted-foreground/50">·</span>
            <span>{totalCount} total appliances</span>
          </div>
          <Button onClick={() => setShowPrepareWizard(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Prepare New Template
          </Button>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search appliances..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex flex-wrap gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          {statusOptions.map((status) => (
            <Badge
              key={status.value}
              variant={selectedStatus.includes(status.value) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => {
                setSelectedStatus(prev =>
                  prev.includes(status.value)
                    ? prev.filter(s => s !== status.value)
                    : [...prev, status.value]
                );
              }}
            >
              {status.label}
              {statusCounts[status.value] ? ` (${statusCounts[status.value]})` : ''}
            </Badge>
          ))}
        </div>

        {/* Appliance Grid/List */}
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading appliances...
          </div>
        ) : filteredTemplates.length === 0 ? (
          <Alert>
            <AlertDescription>
              {searchQuery || selectedStatus.length > 0
                ? "No appliances match your filters"
                : "No ZFS appliances configured yet. Click 'Prepare New Template' to create your first one."}
            </AlertDescription>
          </Alert>
        ) : (
          <div className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
              : 'space-y-2'
          }>
            {filteredTemplates.map((template) => (
              <ZfsApplianceCard
                key={template.id}
                template={template}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        )}
      </div>

      <PrepareTemplateWizard
        open={showPrepareWizard}
        onOpenChange={setShowPrepareWizard}
      />
    </>
  );
};
