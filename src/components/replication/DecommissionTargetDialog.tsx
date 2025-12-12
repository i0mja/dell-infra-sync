import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  Archive,
  Database,
  Trash2,
  Server,
  Shield,
  Link2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { ReplicationTarget } from "@/hooks/useReplication";

export interface TargetDependencies {
  dependentGroups: Array<{ id: string; name: string; vm_count?: number }>;
  partnerTarget: { id: string; name: string } | null;
  hasDeployedVm: boolean;
}

export type DecommissionOption = "archive" | "database" | "full";

interface DecommissionTargetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ReplicationTarget | null;
  dependencies: TargetDependencies | null;
  loading?: boolean;
  onConfirm: (option: DecommissionOption) => Promise<void>;
}

export function DecommissionTargetDialog({
  open,
  onOpenChange,
  target,
  dependencies,
  loading,
  onConfirm,
}: DecommissionTargetDialogProps) {
  const [selectedOption, setSelectedOption] = useState<DecommissionOption>("archive");
  const [confirmationName, setConfirmationName] = useState("");
  const [understoodRisks, setUnderstoodRisks] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedOption("archive");
      setConfirmationName("");
      setUnderstoodRisks(false);
    }
  }, [open]);

  const hasBlockingDependencies = (dependencies?.dependentGroups.length ?? 0) > 0;
  const requiresConfirmation = selectedOption === "full" || selectedOption === "database";
  const nameMatches = confirmationName.toLowerCase() === target?.name?.toLowerCase();
  
  const canProceed = 
    !hasBlockingDependencies && 
    (!requiresConfirmation || (nameMatches && (selectedOption !== "full" || understoodRisks)));

  const handleConfirm = async () => {
    if (!canProceed) return;
    setSubmitting(true);
    try {
      await onConfirm(selectedOption);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getHealthBadge = (status?: string) => {
    switch (status) {
      case "healthy":
        return (
          <Badge variant="outline" className="text-green-600 border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Healthy
          </Badge>
        );
      case "degraded":
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-500/30">
            <AlertCircle className="h-3 w-3 mr-1" />
            Degraded
          </Badge>
        );
      case "offline":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Offline
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Decommission ZFS Target
          </DialogTitle>
          <DialogDescription>
            Choose how to remove "{target.name}" from the system
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Target Info */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-3">
              <Server className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium">{target.name}</p>
                <p className="text-sm text-muted-foreground">
                  {target.hostname} • {target.zfs_pool}
                </p>
              </div>
            </div>
            {getHealthBadge(target.health_status)}
          </div>

          {/* Blocking Dependencies Warning */}
          {hasBlockingDependencies && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Cannot delete - has dependencies</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  This target is used by {dependencies?.dependentGroups.length} protection group(s):
                </p>
                <ul className="list-disc list-inside text-sm">
                  {dependencies?.dependentGroups.map((g) => (
                    <li key={g.id}>
                      {g.name} ({g.vm_count || 0} VMs)
                    </li>
                  ))}
                </ul>
                <p className="text-sm mt-2">
                  Please reassign or delete these protection groups first.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Partner Warning */}
          {dependencies?.partnerTarget && !hasBlockingDependencies && (
            <Alert>
              <Link2 className="h-4 w-4" />
              <AlertTitle>Paired with another target</AlertTitle>
              <AlertDescription>
                This target is paired with <strong>{dependencies.partnerTarget.name}</strong>. 
                The pairing will be removed.
              </AlertDescription>
            </Alert>
          )}

          {/* Options - only show if no blocking dependencies */}
          {!hasBlockingDependencies && (
            <>
              <Separator />
              
              <RadioGroup
                value={selectedOption}
                onValueChange={(v) => setSelectedOption(v as DecommissionOption)}
                className="space-y-3"
              >
                {/* Archive Option */}
                <label
                  htmlFor="archive"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedOption === "archive" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="archive" id="archive" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4" />
                      <span className="font-medium">Archive (Soft Delete)</span>
                      <Badge variant="secondary" className="text-xs">Safe</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Marks target as archived. No VMs moved, no ZFS cleanup. Can be restored later.
                    </p>
                  </div>
                </label>

                {/* Database Only Option */}
                <label
                  htmlFor="database"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedOption === "database" ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="database" id="database" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      <span className="font-medium">Remove from Database</span>
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-500/30">Caution</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Deletes database record and unpairs partner. VM and ZFS resources remain untouched.
                    </p>
                  </div>
                </label>

                {/* Full Decommission Option */}
                <label
                  htmlFor="full"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedOption === "full" ? "border-destructive bg-destructive/5" : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="full" id="full" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Trash2 className="h-4 w-4 text-destructive" />
                      <span className="font-medium">Full Decommission</span>
                      <Badge variant="destructive" className="text-xs">Destructive</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Creates a job to: destroy ZFS pool, power off appliance VM, remove NFS datastore, delete VM from vCenter.
                    </p>
                  </div>
                </label>
              </RadioGroup>

              {/* Confirmation for destructive options */}
              {requiresConfirmation && (
                <div className="space-y-3 p-3 rounded-lg border border-dashed bg-muted/20">
                  <div className="space-y-2">
                    <Label htmlFor="confirm-name" className="text-sm font-medium">
                      Type "{target.name}" to confirm
                    </Label>
                    <Input
                      id="confirm-name"
                      value={confirmationName}
                      onChange={(e) => setConfirmationName(e.target.value)}
                      placeholder={target.name}
                      className={nameMatches ? "border-green-500" : ""}
                    />
                  </div>

                  {selectedOption === "full" && (
                    <div className="flex items-start gap-2">
                      <Checkbox
                        id="understand-risks"
                        checked={understoodRisks}
                        onCheckedChange={(c) => setUnderstoodRisks(c === true)}
                      />
                      <Label htmlFor="understand-risks" className="text-sm text-muted-foreground leading-tight">
                        I understand this will permanently destroy the ZFS pool and delete the VM from vCenter. This action cannot be undone.
                      </Label>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={selectedOption === "full" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={!canProceed || submitting || loading}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : selectedOption === "archive" ? (
              <>
                <Archive className="h-4 w-4 mr-2" />
                Archive Target
              </>
            ) : selectedOption === "database" ? (
              <>
                <Database className="h-4 w-4 mr-2" />
                Remove from Database
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4 mr-2" />
                Decommission
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
