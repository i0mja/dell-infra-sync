import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileDown, FileUp, CheckCircle, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ScpResultsProps {
  details: any;
  jobType: string;
}

export const ScpResults = ({ details, jobType }: ScpResultsProps) => {
  const isExport = jobType === 'scp_export';
  const backupName = details?.backup_name || 'Unnamed Backup';
  const components = details?.components || [];
  const fileSize = details?.file_size_bytes 
    ? `${(details.file_size_bytes / 1024 / 1024).toFixed(2)} MB`
    : 'Unknown';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              {isExport ? <FileDown className="h-4 w-4" /> : <FileUp className="h-4 w-4" />}
              Operation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isExport ? 'Export' : 'Import'}</div>
            <p className="text-xs text-muted-foreground mt-1">SCP backup</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              File Size
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fileSize}</div>
            <p className="text-xs text-muted-foreground mt-1">Configuration data</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Backup Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <span className="text-sm text-muted-foreground">Backup Name:</span>
            <p className="font-medium">{backupName}</p>
          </div>
          
          {components.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">Components:</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {components.map((comp: string, idx: number) => (
                  <Badge key={idx} variant="outline">{comp}</Badge>
                ))}
              </div>
            </div>
          )}

          {details?.server_info && (
            <div>
              <span className="text-sm text-muted-foreground">Server:</span>
              <p className="font-mono text-sm">{details.server_info}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
