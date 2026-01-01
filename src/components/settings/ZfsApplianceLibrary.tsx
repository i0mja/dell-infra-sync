import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Grid3x3, List, Plus, Search, HardDrive, ChevronDown, Wrench } from "lucide-react";
import { useZfsTemplates, ZfsTargetTemplate } from "@/hooks/useZfsTemplates";
import { ZfsApplianceCard } from "./ZfsApplianceCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PrepareTemplateWizard } from "@/components/replication/PrepareTemplateWizard";
import { AddExistingApplianceWizard } from "./AddExistingApplianceWizard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EditApplianceDialog,
  ChangeVCenterDialog,
  CloneTemplateDialog,
  ChangeSshKeyDialog,
  ApplianceDeploymentsDialog,
} from "./appliance-actions";
import { useToast } from "@/hooks/use-toast";

interface ZfsApplianceLibraryProps {
  onSelectAppliance?: (template: any) => void;
}

export const ZfsApplianceLibrary = ({ onSelectAppliance }: ZfsApplianceLibraryProps) => {
  const { 
    templates, 
    loading, 
    deleteTemplate, 
    toggleActive, 
    updateTemplate,
    createTemplate,
    validateTemplate,
    prepareTemplate,
  } = useZfsTemplates();
  const { toast } = useToast();
  
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState("");
  const [showPrepareWizard, setShowPrepareWizard] = useState(false);
  const [showAddExistingWizard, setShowAddExistingWizard] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);

  // Dialog states for actions
  const [editingTemplate, setEditingTemplate] = useState<ZfsTargetTemplate | null>(null);
  const [changingVCenter, setChangingVCenter] = useState<ZfsTargetTemplate | null>(null);
  const [cloningTemplate, setCloningTemplate] = useState<ZfsTargetTemplate | null>(null);
  const [changingSshKey, setChangingSshKey] = useState<ZfsTargetTemplate | null>(null);
  const [viewingDeployments, setViewingDeployments] = useState<ZfsTargetTemplate | null>(null);

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

  const handleEdit = async (id: string, data: Partial<ZfsTargetTemplate>) => {
    await updateTemplate({ id, template: data as any });
  };

  const handleClone = async (data: Partial<ZfsTargetTemplate>) => {
    const { id, created_at, updated_at, ...rest } = data as any;
    await createTemplate({
      ...rest,
      name: rest.name,
      template_moref: rest.template_moref,
      template_name: rest.template_name,
    });
    toast({ title: "Template cloned successfully" });
  };

  const handleSetAsDefault = async (template: ZfsTargetTemplate) => {
    // This would require updating the vcenter's default_zfs_template_id
    toast({ 
      title: "Set as Default", 
      description: `${template.name} would be set as default for its vCenter`,
    });
  };

  const handleReprepare = async (template: ZfsTargetTemplate) => {
    await prepareTemplate({ template_id: template.id });
    toast({ 
      title: "Re-preparation started", 
      description: "Template readiness wizard is running...",
    });
  };

  const handleValidate = async (template: ZfsTargetTemplate) => {
    await validateTemplate({ template_id: template.id, test_ssh: true });
    toast({ 
      title: "Validation started", 
      description: "Testing SSH connectivity...",
    });
  };

  const handleSync = async (template: ZfsTargetTemplate) => {
    // This would trigger a job to sync template info from vCenter
    toast({ 
      title: "Sync from vCenter", 
      description: "Syncing template information...",
    });
  };

  const handleDeprecate = async (template: ZfsTargetTemplate) => {
    await updateTemplate({ id: template.id, template: { status: 'deprecated' } });
    toast({ title: "Template marked as deprecated" });
  };

  const statusOptions = [
    { value: 'draft', label: 'Draft', color: 'bg-muted' },
    { value: 'preparing', label: 'Preparing', color: 'bg-blue-500' },
    { value: 'ready', label: 'Ready', color: 'bg-green-500' },
    { value: 'deprecated', label: 'Deprecated', color: 'bg-orange-500' },
  ];

  return (
    <>
      <div className="space-y-6">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">ZFS Appliances Library</h3>
            <p className="text-sm text-muted-foreground">
              Manage ZFS storage appliance templates for replication
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Appliance
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowPrepareWizard(true)}>
                <Wrench className="h-4 w-4 mr-2" />
                Prepare New Template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowAddExistingWizard(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Existing Appliance
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Stats Row */}
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{readyCount} ready</span>
            </div>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{totalCount} total appliances</span>
          </div>
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
                onEdit={setEditingTemplate}
                onChangeVCenter={setChangingVCenter}
                onSetAsDefault={handleSetAsDefault}
                onClone={setCloningTemplate}
                onChangeSshKey={setChangingSshKey}
                onReprepare={handleReprepare}
                onValidate={handleValidate}
                onViewDeployments={setViewingDeployments}
                onSync={handleSync}
                onDeprecate={handleDeprecate}
              />
            ))}
          </div>
        )}
      </div>

      <PrepareTemplateWizard
        open={showPrepareWizard}
        onOpenChange={setShowPrepareWizard}
      />

      <AddExistingApplianceWizard
        open={showAddExistingWizard}
        onOpenChange={setShowAddExistingWizard}
      />

      {/* Action Dialogs */}
      <EditApplianceDialog
        template={editingTemplate}
        open={!!editingTemplate}
        onOpenChange={(open) => !open && setEditingTemplate(null)}
        onSave={handleEdit}
      />

      <ChangeVCenterDialog
        template={changingVCenter}
        open={!!changingVCenter}
        onOpenChange={(open) => !open && setChangingVCenter(null)}
        onSave={handleEdit}
      />

      <CloneTemplateDialog
        template={cloningTemplate}
        open={!!cloningTemplate}
        onOpenChange={(open) => !open && setCloningTemplate(null)}
        onClone={handleClone}
      />

      <ChangeSshKeyDialog
        template={changingSshKey}
        open={!!changingSshKey}
        onOpenChange={(open) => !open && setChangingSshKey(null)}
        onSave={handleEdit}
      />

      <ApplianceDeploymentsDialog
        template={viewingDeployments}
        open={!!viewingDeployments}
        onOpenChange={(open) => !open && setViewingDeployments(null)}
      />
    </>
  );
};
