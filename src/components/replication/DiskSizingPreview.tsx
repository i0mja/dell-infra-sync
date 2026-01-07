/**
 * Dynamic Disk Sizing Preview Component
 * 
 * Shows a live preview of calculated disk size based on
 * protection group VM storage and headroom percentage.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { HardDrive, Database, TrendingUp, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes, getDiskSizingSummary } from "@/utils/diskSizing";

interface DiskSizingPreviewProps {
  vmStorageBytes: number;
  vmCount: number;
  headroomPercent: number;
  onHeadroomChange: (percent: number) => void;
  protectionGroupName?: string;
  minDiskGb?: number;
  maxDiskGb?: number;
}

export function DiskSizingPreview({
  vmStorageBytes,
  vmCount,
  headroomPercent,
  onHeadroomChange,
  protectionGroupName,
  minDiskGb = 100,
  maxDiskGb = 10000,
}: DiskSizingPreviewProps) {
  const sizing = getDiskSizingSummary(vmStorageBytes, headroomPercent, vmCount);
  
  // Check if disk size is clamped
  const isClamped = sizing.targetDiskGb === minDiskGb || sizing.targetDiskGb === maxDiskGb;
  const isMinClamped = sizing.targetDiskGb === minDiskGb;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Dynamic Disk Sizing
          </CardTitle>
          {protectionGroupName && (
            <Badge variant="outline" className="text-xs">
              {protectionGroupName}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Headroom Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Headroom
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[200px]">
                    <p className="text-xs">
                      Extra space above VM storage for snapshots, growth, and ZFS overhead.
                      50% is recommended for typical workloads.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <span className="text-sm font-medium text-primary">
              {headroomPercent}%
            </span>
          </div>
          <Slider
            value={[headroomPercent]}
            onValueChange={([v]) => onHeadroomChange(v)}
            min={20}
            max={100}
            step={10}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>20% (minimum)</span>
            <span>100% (aggressive)</span>
          </div>
        </div>

        <Separator />

        {/* Sizing Summary */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Database className="h-3 w-3" />
              VM Storage ({vmCount} VMs)
            </span>
            <span className="font-mono">{sizing.vmStorageFormatted}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              + Headroom ({headroomPercent}%)
            </span>
            <span className="font-mono text-muted-foreground">
              {sizing.headroomFormatted}
            </span>
          </div>
          
          <Separator />
          
          <div className="flex items-center justify-between font-medium">
            <span>Total Required</span>
            <span className="font-mono">{sizing.totalFormatted}</span>
          </div>
          
          <div className="flex items-center justify-between pt-2">
            <span className="font-semibold text-primary">Target Disk Size</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold font-mono text-primary">
                {sizing.targetDiskGb} GB
              </span>
              {isClamped && (
                <Badge variant="secondary" className="text-xs">
                  {isMinClamped ? 'min' : 'max'}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Info Note */}
        {vmCount === 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            No VMs in protection group. Using minimum disk size ({minDiskGb} GB).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
