import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Grid3x3, List } from "lucide-react";
import { BackupCard } from "./BackupCard";
import { ScpBackup } from "@/hooks/useScpBackups";

interface BackupsLibraryTabProps {
  backups: ScpBackup[];
  loading: boolean;
  downloadingId: string | null;
  onDownload: (backupId: string, backupName: string) => void;
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onPreview: (backupId: string) => void;
}

export function BackupsLibraryTab({
  backups,
  loading,
  downloadingId,
  onDownload,
  onRestore,
  onDelete,
  onPreview,
}: BackupsLibraryTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filteredBackups = backups.filter((backup) =>
    backup.backup_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search backups..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            onClick={() => setViewMode("grid")}
            className="h-9 w-9 p-0"
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            onClick={() => setViewMode("list")}
            className="h-9 w-9 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading backups...</div>
      ) : filteredBackups.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <p className="text-muted-foreground">
            {searchQuery ? "No backups match your search" : "No backups available"}
          </p>
          {!searchQuery && (
            <p className="text-sm text-muted-foreground">Create your first backup in the Create Backup tab</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{filteredBackups.length} backup(s) found</span>
          </div>
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-1 md:grid-cols-2 gap-4"
                : "space-y-3"
            }
          >
            {filteredBackups.map((backup) => (
              <BackupCard
                key={backup.id}
                backup={backup}
                onDownload={onDownload}
                onRestore={onRestore}
                onDelete={onDelete}
                onPreview={onPreview}
                downloading={downloadingId === backup.id}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
