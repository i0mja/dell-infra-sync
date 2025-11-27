import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Download, Eye, Trash2, Upload } from "lucide-react";
import { format } from "date-fns";
import { ScpBackup } from "@/hooks/useScpBackups";

interface BackupCardProps {
  backup: ScpBackup;
  onDownload: (backupId: string, backupName: string) => void;
  onRestore: (backupId: string) => void;
  onDelete: (backupId: string) => void;
  onPreview: (backupId: string) => void;
  downloading: boolean;
}

export function BackupCard({ backup, onDownload, onRestore, onDelete, onPreview, downloading }: BackupCardProps) {
  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getComponentsBadges = () => {
    const components = [];
    if (backup.include_bios) components.push("BIOS");
    if (backup.include_idrac) components.push("iDRAC");
    if (backup.include_nic) components.push("NIC");
    if (backup.include_raid) components.push("RAID");
    return components;
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <h4 className="font-medium text-sm leading-tight truncate" title={backup.backup_name}>
              {backup.backup_name}
            </h4>
            <p className="text-xs text-muted-foreground">
              {backup.exported_at ? format(new Date(backup.exported_at), "MMM d, yyyy 'at' h:mm a") : "N/A"}
            </p>
          </div>
          {backup.is_valid !== false && (
            <Badge variant="outline" className="text-xs border-green-500/50 text-green-600 dark:text-green-400">
              Valid
            </Badge>
          )}
        </div>

        {backup.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{backup.description}</p>
        )}

        <div className="flex flex-wrap gap-1">
          {getComponentsBadges().map((component) => (
            <Badge key={component} variant="secondary" className="text-xs">
              {component}
            </Badge>
          ))}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>{formatFileSize(backup.scp_file_size_bytes)}</span>
          {backup.checksum && (
            <span className="font-mono truncate max-w-[120px]" title={backup.checksum}>
              SHA: {backup.checksum.substring(0, 8)}...
            </span>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex gap-1 pt-0 pb-4">
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 h-8 text-xs"
          onClick={() => onPreview(backup.id)}
        >
          <Eye className="h-3 w-3 mr-1" />
          Preview
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 h-8 text-xs"
          onClick={() => onDownload(backup.id, backup.backup_name)}
          disabled={downloading}
        >
          <Download className="h-3 w-3 mr-1" />
          Download
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="flex-1 h-8 text-xs"
          onClick={() => onRestore(backup.id)}
        >
          <Upload className="h-3 w-3 mr-1" />
          Restore
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => onDelete(backup.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </CardFooter>
    </Card>
  );
}
