import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  Server, 
  ArrowLeftRight, 
  MoreVertical, 
  HeartPulse, 
  Pencil, 
  Trash2,
  Link2,
  Unlink,
  Database,
  Key,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  HardDrive,
  RefreshCw
} from "lucide-react";
import { ReplicationTarget } from "@/hooks/useReplication";
import { formatDistanceToNow } from "date-fns";

interface ZfsTargetPairCardProps {
  primary: ReplicationTarget;
  partner?: ReplicationTarget | null;
  onHealthCheck: (target: ReplicationTarget) => void;
  onEdit: (target: ReplicationTarget) => void;
  onPair: (target: ReplicationTarget) => void;
  onUnpair: (target: ReplicationTarget) => void;
  onDelete: (target: ReplicationTarget) => void;
  onManageDatastore: (target: ReplicationTarget) => void;
  onDeploySshKey: (target: ReplicationTarget) => void;
  healthCheckingId?: string | null;
}

function HealthBadge({ status }: { status?: string }) {
  switch (status) {
    case 'healthy':
      return (
        <Badge variant="outline" className="text-green-600 border-green-500/30 gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Healthy
        </Badge>
      );
    case 'degraded':
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-500/30 gap-1">
          <AlertCircle className="h-3 w-3" />
          Degraded
        </Badge>
      );
    case 'offline':
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Offline
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <AlertCircle className="h-3 w-3" />
          Unknown
        </Badge>
      );
  }
}

function SshStatus({ hasSshKey }: { hasSshKey: boolean }) {
  if (hasSshKey) {
    return (
      <span className="text-xs text-green-600 flex items-center gap-1">
        <Key className="h-3 w-3" />
        SSH Ready
      </span>
    );
  }
  return (
    <span className="text-xs text-amber-600 flex items-center gap-1">
      <Key className="h-3 w-3" />
      No SSH Key
    </span>
  );
}

function TargetCard({ 
  target, 
  role, 
  onHealthCheck, 
  onEdit, 
  onDelete, 
  onManageDatastore,
  onDeploySshKey,
  healthCheckingId 
}: { 
  target: ReplicationTarget; 
  role: 'primary' | 'dr';
  onHealthCheck: (t: ReplicationTarget) => void;
  onEdit: (t: ReplicationTarget) => void;
  onDelete: (t: ReplicationTarget) => void;
  onManageDatastore: (t: ReplicationTarget) => void;
  onDeploySshKey: (t: ReplicationTarget) => void;
  healthCheckingId?: string | null;
}) {
  const isChecking = healthCheckingId === target.id;
  
  return (
    <div className="flex-1 p-3 rounded-lg border bg-card min-w-0">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-medium truncate">{target.name}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0">
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover">
            <DropdownMenuItem onClick={() => onHealthCheck(target)}>
              <HeartPulse className="h-4 w-4 mr-2" />
              Health Check
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(target)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onManageDatastore(target)}>
              <HardDrive className="h-4 w-4 mr-2" />
              Datastore
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDeploySshKey(target)}>
              <Key className="h-4 w-4 mr-2" />
              Deploy SSH Key
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDelete(target)} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="space-y-1.5 text-sm">
        <div className="text-muted-foreground truncate">
          {target.hosting_vm?.ip_address || target.hostname}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3 w-3" />
          <span className="truncate">{target.zfs_pool}</span>
        </div>
        {target.datastore_name && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="h-3 w-3" />
            <span className="truncate">{target.datastore_name}</span>
          </div>
        )}
      </div>
      
      <div className="flex items-center justify-between mt-3 pt-2 border-t">
        <HealthBadge status={target.health_status} />
        <SshStatus hasSshKey={!!target.ssh_key_id} />
      </div>
      
      {isChecking && (
        <div className="flex items-center gap-2 mt-2 text-xs text-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking...
        </div>
      )}
      
      {target.last_health_check && !isChecking && (
        <div className="text-xs text-muted-foreground mt-2">
          Checked {formatDistanceToNow(new Date(target.last_health_check), { addSuffix: true })}
        </div>
      )}
    </div>
  );
}

export function ZfsTargetPairCard({
  primary,
  partner,
  onHealthCheck,
  onEdit,
  onPair,
  onUnpair,
  onDelete,
  onManageDatastore,
  onDeploySshKey,
  healthCheckingId,
}: ZfsTargetPairCardProps) {
  const isPaired = !!partner;
  
  // Determine connection status based on SSH keys
  const hasBothSshKeys = !!primary.ssh_key_id && !!partner?.ssh_key_id;
  
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {primary.site_role === 'primary' ? 'Primary Site' : 'DR Site'}
          </Badge>
          {isPaired && (
            <Badge variant="outline" className="text-xs text-blue-600 border-blue-500/30">
              <Link2 className="h-3 w-3 mr-1" />
              Paired
            </Badge>
          )}
        </div>
        {isPaired && (
          <Button variant="ghost" size="sm" onClick={() => onUnpair(primary)} className="h-7 text-xs">
            <Unlink className="h-3 w-3 mr-1" />
            Unpair
          </Button>
        )}
      </div>
      
      {/* Cards Container */}
      <div className="flex items-stretch gap-3">
        {/* Primary Target */}
        <TargetCard 
          target={primary}
          role="primary"
          onHealthCheck={onHealthCheck}
          onEdit={onEdit}
          onDelete={onDelete}
          onManageDatastore={onManageDatastore}
          onDeploySshKey={onDeploySshKey}
          healthCheckingId={healthCheckingId}
        />
        
        {/* Connection Indicator */}
        {isPaired && partner && (
          <div className="flex flex-col items-center justify-center px-2">
            <div className={`w-8 h-0.5 ${hasBothSshKeys ? 'bg-green-500' : 'bg-amber-500'} rounded`} />
            <ArrowLeftRight className={`h-4 w-4 my-1 ${hasBothSshKeys ? 'text-green-500' : 'text-amber-500'}`} />
            <div className={`w-8 h-0.5 ${hasBothSshKeys ? 'bg-green-500' : 'bg-amber-500'} rounded`} />
            <span className={`text-[10px] mt-1 ${hasBothSshKeys ? 'text-green-600' : 'text-amber-600'}`}>
              {hasBothSshKeys ? 'Ready' : 'Setup'}
            </span>
          </div>
        )}
        
        {/* Partner Target or Pair Button */}
        {isPaired && partner ? (
          <TargetCard 
            target={partner}
            role="dr"
            onHealthCheck={onHealthCheck}
            onEdit={onEdit}
            onDelete={onDelete}
            onManageDatastore={onManageDatastore}
            onDeploySshKey={onDeploySshKey}
            healthCheckingId={healthCheckingId}
          />
        ) : (
          <div className="flex-1 p-4 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center min-h-[140px]">
            <Link2 className="h-6 w-6 text-muted-foreground/50 mb-2" />
            <span className="text-sm text-muted-foreground mb-2">No DR Partner</span>
            <Button variant="outline" size="sm" onClick={() => onPair(primary)}>
              <Link2 className="h-3 w-3 mr-1" />
              Pair Target
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
