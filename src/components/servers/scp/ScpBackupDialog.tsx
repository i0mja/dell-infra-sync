import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileJson, Download, BookOpen, Upload as UploadIcon } from "lucide-react";
import { format } from "date-fns";
import { useScpBackups } from "@/hooks/useScpBackups";
import { CreateBackupTab } from "./CreateBackupTab";
import { BackupsLibraryTab } from "./BackupsLibraryTab";
import { ImportFromFileTab } from "./ImportFromFileTab";
import { BackupPreviewDialog } from "./BackupPreviewDialog";
import { RestoreDialog } from "./RestoreDialog";

interface ScpBackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    hostname: string | null;
    ip_address: string;
  };
}

export function ScpBackupDialog({ open, onOpenChange, server }: ScpBackupDialogProps) {
  const [activeTab, setActiveTab] = useState<"create" | "library" | "import">("create");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [backupToDelete, setBackupToDelete] = useState<string | null>(null);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewBackupId, setPreviewBackupId] = useState<string | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreBackupId, setRestoreBackupId] = useState<string | null>(null);

  const { backups, recentJobs, loadingBackups, fetchBackups, fetchRecentJobs } = useScpBackups(server.id, open);

  const handleDownload = async (backupId: string, backupName: string) => {
    setDownloadingId(backupId);
    try {
      const { data, error } = await supabase
        .from("scp_backups")
        .select("scp_content")
        .eq("id", backupId)
        .single();

      if (error) throw error;

      if (!data?.scp_content) {
        toast.error("Run a new SCP export to generate a downloadable backup.");
        return;
      }

      const jsonString =
        typeof data.scp_content === "string"
          ? data.scp_content
          : JSON.stringify(data.scp_content, null, 2);

      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fallbackName = `${server.hostname || server.ip_address}-scp-backup-${format(
        new Date(),
        "yyyyMMdd-HHmmss"
      )}`;
      link.href = url;
      link.download = `${backupName || fallbackName}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success("SCP backup downloaded");
    } catch (error: any) {
      console.error("Error downloading backup:", error);
      toast.error("Failed to download backup", {
        description: error.message,
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteBackup = async () => {
    if (!backupToDelete) return;

    try {
      const { error } = await supabase
        .from("scp_backups")
        .delete()
        .eq("id", backupToDelete);

      if (error) throw error;

      toast.success("Backup deleted");
      fetchBackups();
    } catch (error: any) {
      console.error("Error deleting backup:", error);
      toast.error("Failed to delete backup");
    } finally {
      setDeleteDialogOpen(false);
      setBackupToDelete(null);
    }
  };

  const handlePreview = (backupId: string) => {
    setPreviewBackupId(backupId);
    setPreviewDialogOpen(true);
  };

  const handleRestore = (backupId: string) => {
    setRestoreBackupId(backupId);
    setRestoreDialogOpen(true);
  };

  const confirmDelete = (backupId: string) => {
    setBackupToDelete(backupId);
    setDeleteDialogOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              SCP Configuration Manager - {server.hostname || server.ip_address}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="create">
                <Download className="h-4 w-4 mr-2" />
                Create Backup
              </TabsTrigger>
              <TabsTrigger value="library">
                <BookOpen className="h-4 w-4 mr-2" />
                Backups Library
              </TabsTrigger>
              <TabsTrigger value="import">
                <UploadIcon className="h-4 w-4 mr-2" />
                Import from File
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-y-auto mt-4">
              <TabsContent value="create" className="mt-0">
                <CreateBackupTab
                  serverId={server.id}
                  serverName={server.hostname || server.ip_address}
                  recentJobs={recentJobs}
                  onJobsRefresh={() => fetchRecentJobs(true)}
                />
              </TabsContent>

              <TabsContent value="library" className="mt-0">
                <BackupsLibraryTab
                  backups={backups}
                  loading={loadingBackups}
                  downloadingId={downloadingId}
                  onDownload={handleDownload}
                  onRestore={handleRestore}
                  onDelete={confirmDelete}
                  onPreview={handlePreview}
                />
              </TabsContent>

              <TabsContent value="import" className="mt-0">
                <ImportFromFileTab serverId={server.id} />
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this backup? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBackup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BackupPreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        backupId={previewBackupId}
      />

      <RestoreDialog
        open={restoreDialogOpen}
        onOpenChange={setRestoreDialogOpen}
        backupId={restoreBackupId}
        serverId={server.id}
        onRestoreComplete={() => {
          fetchBackups();
          fetchRecentJobs(true);
        }}
      />
    </>
  );
}
