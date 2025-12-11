import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  HardDrive, 
  Trash2, 
  Rocket, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  Power,
  PowerOff,
  Settings,
  Key,
  Server,
  Pencil,
  Copy,
  RefreshCw,
  RefreshCcw,
  Archive,
  List,
  Star
} from "lucide-react";
import { ZfsTargetTemplate } from "@/hooks/useZfsTemplates";
import { formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ZfsApplianceCardProps {
  template: ZfsTargetTemplate & {
    status?: string;
    version?: string;
    deployment_count?: number;
    last_deployed_at?: string;
  };
  onSelect: (template: ZfsTargetTemplate) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  // Extended actions
  onEdit?: (template: ZfsTargetTemplate) => void;
  onChangeVCenter?: (template: ZfsTargetTemplate) => void;
  onSetAsDefault?: (template: ZfsTargetTemplate) => void;
  onClone?: (template: ZfsTargetTemplate) => void;
  onChangeSshKey?: (template: ZfsTargetTemplate) => void;
  onReprepare?: (template: ZfsTargetTemplate) => void;
  onValidate?: (template: ZfsTargetTemplate) => void;
  onViewDeployments?: (template: ZfsTargetTemplate) => void;
  onSync?: (template: ZfsTargetTemplate) => void;
  onDeprecate?: (template: ZfsTargetTemplate) => void;
}

export const ZfsApplianceCard = ({ 
  template, 
  onSelect, 
  onDelete,
  onToggleActive,
  onEdit,
  onChangeVCenter,
  onSetAsDefault,
  onClone,
  onChangeSshKey,
  onReprepare,
  onValidate,
  onViewDeployments,
  onSync,
  onDeprecate,
}: ZfsApplianceCardProps) => {
  const getStatusBadge = () => {
    const status = template.status || 'draft';
    switch (status) {
      case 'ready':
        return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Ready</Badge>;
      case 'preparing':
        return <Badge className="bg-blue-500"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Preparing</Badge>;
      case 'deprecated':
        return <Badge className="bg-orange-500"><AlertCircle className="h-3 w-3 mr-1" />Deprecated</Badge>;
      default:
        return <Badge variant="secondary">Draft</Badge>;
    }
  };

  const isDeployable = template.status === 'ready' && template.is_active;

  return (
    <Card className="group hover:shadow-lg transition-all">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className={`h-12 w-12 rounded-lg flex items-center justify-center ${
              template.is_active ? 'bg-primary/10' : 'bg-muted'
            }`}>
              <HardDrive className={`h-6 w-6 ${template.is_active ? 'text-primary' : 'text-muted-foreground'}`} />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium truncate">{template.name}</h4>
                {template.version && (
                  <Badge variant="outline" className="text-xs">{template.version}</Badge>
                )}
              </div>
              {getStatusBadge()}
            </div>
            
            {template.description && (
              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                {template.description}
              </p>
            )}
            
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-2">
              <span className="flex items-center gap-1">
                <Server className="h-3 w-3" />
                {template.template_name}
              </span>
              {template.ssh_key_id && (
                <span className="flex items-center gap-1 text-green-600">
                  <Key className="h-3 w-3" />
                  SSH Key
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground mb-2">
              <span>{template.default_cpu_count} vCPU</span>
              <span>•</span>
              <span>{template.default_memory_gb} GB RAM</span>
              <span>•</span>
              <span>{template.default_zfs_disk_gb} GB ZFS</span>
            </div>
            
            {(template.deployment_count ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Deployed {template.deployment_count}x</span>
                {template.last_deployed_at && (
                  <>
                    <span>•</span>
                    <span>Last: {formatDistanceToNow(new Date(template.last_deployed_at), { addSuffix: true })}</span>
                  </>
                )}
              </div>
            )}

            {!template.is_active && (
              <Badge variant="outline" className="mt-2 text-muted-foreground">
                <PowerOff className="h-3 w-3 mr-1" />
                Inactive
              </Badge>
            )}
          </div>
        </div>
        
        <div className="flex gap-2 mt-3 pt-3 border-t">
          <Button
            size="sm"
            onClick={() => onSelect(template)}
            disabled={!isDeployable}
            className="flex-1"
          >
            <Rocket className="h-3 w-3 mr-1" />
            Deploy
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                <Settings className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Edit */}
              {onEdit && (
                <DropdownMenuItem onClick={() => onEdit(template)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Details
                </DropdownMenuItem>
              )}
              
              {/* Change vCenter/Site */}
              {onChangeVCenter && (
                <DropdownMenuItem onClick={() => onChangeVCenter(template)}>
                  <Server className="h-4 w-4 mr-2" />
                  Change Site
                </DropdownMenuItem>
              )}
              
              {/* Set as Default */}
              {onSetAsDefault && (
                <DropdownMenuItem onClick={() => onSetAsDefault(template)}>
                  <Star className="h-4 w-4 mr-2" />
                  Set as Default
                </DropdownMenuItem>
              )}
              
              {/* Clone */}
              {onClone && (
                <DropdownMenuItem onClick={() => onClone(template)}>
                  <Copy className="h-4 w-4 mr-2" />
                  Clone Template
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />
              
              {/* SSH Key */}
              {onChangeSshKey && (
                <DropdownMenuItem onClick={() => onChangeSshKey(template)}>
                  <Key className="h-4 w-4 mr-2" />
                  Change SSH Key
                </DropdownMenuItem>
              )}
              
              {/* Re-prepare */}
              {onReprepare && (
                <DropdownMenuItem onClick={() => onReprepare(template)}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Re-prepare Template
                </DropdownMenuItem>
              )}
              
              {/* Validate */}
              {onValidate && (
                <DropdownMenuItem onClick={() => onValidate(template)}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Validate (Test SSH)
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />
              
              {/* View Deployments */}
              {onViewDeployments && (
                <DropdownMenuItem onClick={() => onViewDeployments(template)}>
                  <List className="h-4 w-4 mr-2" />
                  View Deployments {(template.deployment_count ?? 0) > 0 && `(${template.deployment_count})`}
                </DropdownMenuItem>
              )}
              
              {/* Sync from vCenter */}
              {onSync && (
                <DropdownMenuItem onClick={() => onSync(template)}>
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Sync from vCenter
                </DropdownMenuItem>
              )}
              
              <DropdownMenuSeparator />
              
              {/* Deprecate */}
              {onDeprecate && template.status !== 'deprecated' && (
                <DropdownMenuItem onClick={() => onDeprecate(template)}>
                  <Archive className="h-4 w-4 mr-2" />
                  Mark as Deprecated
                </DropdownMenuItem>
              )}
              
              {/* Activate/Deactivate */}
              <DropdownMenuItem onClick={() => onToggleActive(template.id, !template.is_active)}>
                {template.is_active ? (
                  <>
                    <PowerOff className="h-4 w-4 mr-2" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4 mr-2" />
                    Activate
                  </>
                )}
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              {/* Delete */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem 
                    className="text-destructive"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Appliance Template</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{template.name}"? This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(template.id)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
};
