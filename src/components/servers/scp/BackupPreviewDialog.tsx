import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileJson, Download, Loader2, Copy, Check } from "lucide-react";
import { format } from "date-fns";

interface BackupPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backupId: string | null;
}

export function BackupPreviewDialog({ open, onOpenChange, backupId }: BackupPreviewDialogProps) {
  const [loading, setLoading] = useState(false);
  const [backup, setBackup] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && backupId) {
      fetchBackupDetails();
    }
  }, [open, backupId]);

  const fetchBackupDetails = async () => {
    if (!backupId) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("scp_backups")
        .select("*")
        .eq("id", backupId)
        .single();

      if (error) throw error;
      setBackup(data);
    } catch (error: any) {
      console.error("Error fetching backup details:", error);
      toast.error("Failed to load backup details");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyChecksum = () => {
    if (backup?.checksum) {
      navigator.clipboard.writeText(backup.checksum);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Checksum copied to clipboard");
    }
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getComponents = () => {
    if (!backup) return [];
    const components = [];
    if (backup.include_bios) components.push("BIOS");
    if (backup.include_idrac) components.push("iDRAC");
    if (backup.include_nic) components.push("NIC");
    if (backup.include_raid) components.push("RAID");
    return components;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Backup Preview
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : backup ? (
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-6 pr-4">
              <div className="space-y-3">
                <div>
                  <h4 className="font-semibold mb-1">{backup.backup_name}</h4>
                  {backup.description && (
                    <p className="text-sm text-muted-foreground">{backup.description}</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {getComponents().map((component) => (
                    <Badge key={component} variant="secondary">
                      {component}
                    </Badge>
                  ))}
                  {backup.is_valid !== false && (
                    <Badge variant="outline" className="border-green-500/50 text-green-600 dark:text-green-400">
                      Valid
                    </Badge>
                  )}
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground mb-1">Exported</p>
                  <p className="font-medium">
                    {backup.exported_at ? format(new Date(backup.exported_at), "PPpp") : "N/A"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">File Size</p>
                  <p className="font-medium">{formatFileSize(backup.scp_file_size_bytes)}</p>
                </div>
                {backup.last_imported_at && (
                  <div>
                    <p className="text-muted-foreground mb-1">Last Restored</p>
                    <p className="font-medium">{format(new Date(backup.last_imported_at), "PPpp")}</p>
                  </div>
                )}
              </div>

              {backup.checksum && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">SHA-256 Checksum</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono bg-muted p-2 rounded break-all">
                        {backup.checksum}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleCopyChecksum}
                        className="h-8 w-8 p-0"
                      >
                        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </>
              )}

              {!backup.scp_content && (
                <>
                  <Separator />
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md p-3">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      Full backup contents are not available for preview. Run a new export to enable content viewing.
                    </p>
                  </div>
                </>
              )}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center py-8 text-muted-foreground">No backup data available</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
