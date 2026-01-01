import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { 
  Loader2, 
  Search, 
  Server, 
  Database,
  HardDrive,
  Cloud,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import type { ScanTarget, FirmwareSource } from './types';

interface UpdateAvailabilityScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ScanTarget;
  onStartScan: (firmwareSource: FirmwareSource) => Promise<void>;
  isScanning?: boolean;
  scanProgress?: {
    scannedHosts: number;
    totalHosts: number;
    currentHost?: string;
    updatesFound: number;
    criticalFound: number;
  };
}

function getTargetIcon(type: ScanTarget['type']) {
  switch (type) {
    case 'cluster':
      return Database;
    case 'group':
      return Server;
    case 'servers':
    case 'single_host':
      return HardDrive;
    default:
      return Server;
  }
}

function getTargetLabel(type: ScanTarget['type']) {
  switch (type) {
    case 'cluster':
      return 'Cluster';
    case 'group':
      return 'Server Group';
    case 'servers':
      return 'Selected Servers';
    case 'single_host':
      return 'Single Host';
    default:
      return 'Target';
  }
}

export function UpdateAvailabilityScanDialog({
  open,
  onOpenChange,
  target,
  onStartScan,
  isScanning,
  scanProgress,
}: UpdateAvailabilityScanDialogProps) {
  const [firmwareSource, setFirmwareSource] = useState<FirmwareSource>('local_repository');

  const handleStartScan = async () => {
    await onStartScan(firmwareSource);
  };

  const TargetIcon = getTargetIcon(target.type);
  const targetCount = target.serverIds?.length || target.vcenterHostIds?.length || 1;
  const progressPercent = scanProgress && scanProgress.totalHosts > 0
    ? Math.round((scanProgress.scannedHosts / scanProgress.totalHosts) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Check for Updates
          </DialogTitle>
          <DialogDescription>
            Scan firmware and ESXi versions to identify available updates.
          </DialogDescription>
        </DialogHeader>

        {isScanning ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center gap-2 text-primary">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="font-medium">Scanning in progress...</span>
            </div>
            
            <Progress value={progressPercent} className="h-2" />
            
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {scanProgress?.scannedHosts || 0} of {scanProgress?.totalHosts || targetCount} hosts
              </span>
              <span>{progressPercent}%</span>
            </div>

            {scanProgress?.currentHost && (
              <p className="text-sm text-center text-muted-foreground">
                Currently scanning: <span className="font-medium">{scanProgress.currentHost}</span>
              </p>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-2xl font-bold text-primary">{scanProgress?.updatesFound || 0}</p>
                <p className="text-xs text-muted-foreground">Updates Found</p>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className={`text-2xl font-bold ${(scanProgress?.criticalFound || 0) > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {scanProgress?.criticalFound || 0}
                </p>
                <p className="text-xs text-muted-foreground">Critical Updates</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Target Summary */}
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <TargetIcon className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">{target.name || getTargetLabel(target.type)}</p>
                <p className="text-sm text-muted-foreground">
                  {targetCount} host{targetCount !== 1 ? 's' : ''} will be scanned
                </p>
              </div>
              <Badge variant="outline">
                {getTargetLabel(target.type)}
              </Badge>
            </div>

            <Separator />

            {/* Firmware Source Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Firmware Source</Label>
              <RadioGroup
                value={firmwareSource}
                onValueChange={(v) => setFirmwareSource(v as FirmwareSource)}
                className="space-y-2"
              >
                <label
                  htmlFor="local_repository"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    firmwareSource === 'local_repository' 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value="local_repository" id="local_repository" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4" />
                      <span className="font-medium">Local Repository</span>
                      <Badge variant="secondary" className="text-xs">Recommended</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Compare against firmware packages uploaded to your local repository. Faster and uses pre-validated packages.
                    </p>
                  </div>
                </label>

                <label
                  htmlFor="dell_online_catalog"
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    firmwareSource === 'dell_online_catalog' 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <RadioGroupItem value="dell_online_catalog" id="dell_online_catalog" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Cloud className="h-4 w-4" />
                      <span className="font-medium">Dell Online Catalog</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Check against Dell's latest online catalog for the most up-to-date firmware availability. Requires internet access.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <Separator />

            {/* What will be checked */}
            <div className="space-y-2">
              <p className="text-sm font-medium">This scan will check:</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>BIOS versions</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>iDRAC firmware</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>Network adapters</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>RAID controllers</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>ESXi version</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span>Power supplies</span>
                </div>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          {isScanning ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Run in Background
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleStartScan}>
                <Search className="mr-2 h-4 w-4" />
                Start Scan
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
