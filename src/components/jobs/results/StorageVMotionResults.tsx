import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HardDrive, MoveRight, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";

interface StorageVMotionResultsProps {
  details: any;
  status?: string;
}

export const StorageVMotionResults = ({ details, status }: StorageVMotionResultsProps) => {
  const vmName = details?.vm_name || details?.protected_vm_name;
  const sourceDatastore = details?.source_datastore || details?.current_datastore;
  const targetDatastore = details?.target_datastore;
  const protectionGroup = details?.protection_group_name;

  // Pending state - waiting for job executor
  if (status === 'pending') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Storage vMotion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg flex items-center gap-3 bg-muted border border-border">
            <Clock className="h-5 w-5 text-muted-foreground animate-pulse" />
            <div>
              <p className="font-medium">Waiting for Job Executor</p>
              <p className="text-sm text-muted-foreground">
                Job queued, waiting to be picked up...
              </p>
            </div>
          </div>
          {(targetDatastore || protectionGroup) && (
            <div className="space-y-2">
              {targetDatastore && (
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Target Datastore</span>
                  <Badge variant="outline">{targetDatastore}</Badge>
                </div>
              )}
              {protectionGroup && (
                <div className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm text-muted-foreground">Protection Group</span>
                  <span className="font-medium">{protectionGroup}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Running state - vMotion in progress
  if (status === 'running') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4" />
            Storage vMotion
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 rounded-lg flex items-center gap-3 bg-primary/10 border border-primary/20">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
            <div>
              <p className="font-medium text-primary">Storage vMotion in Progress</p>
              <p className="text-sm text-muted-foreground">
                {vmName ? `Relocating ${vmName}` : 'Relocating VM'}{targetDatastore ? ` to ${targetDatastore}` : ''}...
              </p>
            </div>
          </div>
          {(sourceDatastore || targetDatastore) && (
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Migration Path</span>
              <div className="flex items-center gap-2">
                {sourceDatastore && <Badge variant="outline">{sourceDatastore}</Badge>}
                {sourceDatastore && targetDatastore && <MoveRight className="h-4 w-4 text-primary" />}
                {targetDatastore && <Badge variant="default">{targetDatastore}</Badge>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Completed/Failed state - show results
  if (!details) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No storage vMotion details available.
        </CardContent>
      </Card>
    );
  }

  const success = details.success !== false && !details.error;
  const message = details.message || details.error;
  const durationSeconds = details.duration_seconds;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          Storage vMotion Results
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Banner */}
        <div className={`p-3 rounded-lg flex items-center gap-3 ${
          success ? 'bg-green-500/10 border border-green-500/20' : 'bg-destructive/10 border border-destructive/20'
        }`}>
          {success ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-destructive" />
          )}
          <div>
            <p className={`font-medium ${success ? 'text-green-500' : 'text-destructive'}`}>
              {success ? 'VM Relocated Successfully' : 'Relocation Failed'}
            </p>
            {message && (
              <p className="text-sm text-muted-foreground">{message}</p>
            )}
          </div>
        </div>

        {/* VM Details */}
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm text-muted-foreground">Virtual Machine</span>
            <span className="font-medium">{vmName}</span>
          </div>

          {/* Datastore Migration Path */}
          {(sourceDatastore || targetDatastore) && (
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Datastore Migration</span>
              <div className="flex items-center gap-2">
                {sourceDatastore && (
                  <Badge variant="outline">{sourceDatastore}</Badge>
                )}
                {sourceDatastore && targetDatastore && (
                  <MoveRight className="h-4 w-4 text-primary" />
                )}
                {targetDatastore && (
                  <Badge variant="default">{targetDatastore}</Badge>
                )}
              </div>
            </div>
          )}

          {protectionGroup && (
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground">Protection Group</span>
              <span className="font-medium">{protectionGroup}</span>
            </div>
          )}

          {durationSeconds !== undefined && (
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Duration
              </span>
              <span className="font-medium">
                {durationSeconds < 60 
                  ? `${durationSeconds}s` 
                  : `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
