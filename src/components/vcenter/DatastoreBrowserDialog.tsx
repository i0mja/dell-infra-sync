import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, FolderOpen, FileArchive, Filter, AlertTriangle, Disc, Check } from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useAccessibleDatastores } from "@/hooks/useAccessibleDatastores";
import { useDatastoreBrowser, DatastoreFile } from "@/hooks/useDatastoreBrowser";
import { formatBytes } from "@/lib/utils";

interface DatastoreBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSelect: (file: DatastoreFile, datastoreName: string) => void;
  filePatterns?: string[];
  targetCluster?: string;
}

// Helper to strip datastore prefix from folder path
function cleanFolderPath(folder: string, datastoreName: string): string {
  if (!folder) return "";
  // Remove patterns like [DATASTORE-NAME] or [datastore-name] from start
  const pattern = new RegExp(`^\\[${datastoreName}\\]\\s*`, "i");
  return folder.replace(pattern, "").trim() || "/";
}

// Format date nicely
function formatFileDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, { 
      month: "short", 
      day: "numeric", 
      year: "numeric" 
    });
  } catch {
    return "-";
  }
}

// Get file icon based on extension
function getFileIcon(filename: string) {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "iso") {
    return <Disc className="h-4 w-4 text-blue-500" />;
  }
  return <FileArchive className="h-4 w-4 text-amber-500" />;
}

export function DatastoreBrowserDialog({
  open,
  onOpenChange,
  onFileSelect,
  filePatterns = ["*.zip", "*.iso"],
  targetCluster,
}: DatastoreBrowserDialogProps) {
  const { vcenters } = useVCenters();
  const [selectedVCenterId, setSelectedVCenterId] = useState<string>("");
  const [selectedDatastoreName, setSelectedDatastoreName] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<DatastoreFile | null>(null);

  const { data: datastores = [], isLoading: loadingDatastores } = useAccessibleDatastores(
    selectedVCenterId,
    targetCluster
  );
  const { browsing, files, browseDatastore } = useDatastoreBrowser();

  const noAccessibleDatastores = targetCluster && 
    datastores.length === 0 && 
    !loadingDatastores;

  // Auto-select first vCenter if only one
  useEffect(() => {
    if (vcenters.length === 1 && !selectedVCenterId) {
      setSelectedVCenterId(vcenters[0].id);
    }
  }, [vcenters, selectedVCenterId]);

  const handleBrowse = () => {
    if (selectedVCenterId && selectedDatastoreName) {
      browseDatastore(selectedVCenterId, selectedDatastoreName, "", filePatterns);
    }
  };

  const handleSelect = () => {
    if (selectedFile && selectedDatastoreName) {
      onFileSelect(selectedFile, selectedDatastoreName);
    }
  };

  const selectedDatastore = datastores.find((ds) => ds.name === selectedDatastoreName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Browse Datastore for ESXi Bundle</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cluster Filter Indicator */}
          {targetCluster && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-2 rounded-lg">
              <Filter className="h-4 w-4" />
              <span>
                Showing datastores accessible by all hosts in: <strong>{targetCluster}</strong>
              </span>
            </div>
          )}

          {/* Warning if no accessible datastores */}
          {noAccessibleDatastores && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No datastores are accessible by all hosts in cluster "{targetCluster}". 
                You may need to upload the ESXi bundle to a shared datastore or use HTTP delivery.
              </AlertDescription>
            </Alert>
          )}
          {/* vCenter Selection */}
          {vcenters.length > 1 && (
            <div className="space-y-2">
              <Label>vCenter</Label>
              <Select value={selectedVCenterId} onValueChange={setSelectedVCenterId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vCenter" />
                </SelectTrigger>
                <SelectContent>
                  {vcenters.map((vc) => (
                    <SelectItem key={vc.id} value={vc.id}>
                      {vc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Datastore Selection */}
          <div className="space-y-2">
            <Label>Datastore</Label>
            <Select
              value={selectedDatastoreName}
              onValueChange={setSelectedDatastoreName}
              disabled={!selectedVCenterId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select datastore" />
              </SelectTrigger>
              <SelectContent>
                {datastores.map((ds) => (
                  <SelectItem key={ds.id} value={ds.name}>
                    <div className="flex items-center justify-between w-full">
                      <span>{ds.name}</span>
                      <span className="text-xs text-muted-foreground ml-4">
                        {formatBytes(ds.capacity_bytes)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedDatastore && (
              <p className="text-xs text-muted-foreground">
                {selectedDatastore.free_bytes && selectedDatastore.capacity_bytes && (
                  <>
                    {formatBytes(selectedDatastore.free_bytes)} free of{" "}
                    {formatBytes(selectedDatastore.capacity_bytes)}
                  </>
                )}
              </p>
            )}
          </div>

          {/* Browse Button */}
          <Button
            onClick={handleBrowse}
            disabled={!selectedVCenterId || !selectedDatastoreName || browsing}
            className="w-full"
          >
            {browsing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Browsing...
              </>
            ) : (
              <>
                <FolderOpen className="h-4 w-4 mr-2" />
                Browse Files
              </>
            )}
          </Button>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Files ({filePatterns.join(", ")})</Label>
                <span className="text-xs text-muted-foreground">{files.length} found</span>
              </div>
              
              {/* Table Header */}
              <div className="grid grid-cols-[1fr_100px_100px] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                <span>Name / Location</span>
                <span className="text-right">Size</span>
                <span className="text-right">Modified</span>
              </div>
              
              <ScrollArea className="h-[280px] border rounded-lg">
                <div className="divide-y divide-border">
                  {files.map((file, idx) => {
                    const isSelected = selectedFile?.full_path === file.full_path;
                    const cleanPath = cleanFolderPath(file.folder, selectedDatastoreName);
                    
                    return (
                      <button
                        key={idx}
                        onClick={() => setSelectedFile(file)}
                        className={`w-full grid grid-cols-[1fr_100px_100px] gap-2 px-3 py-3 text-left transition-colors ${
                          isSelected 
                            ? "bg-primary/10 border-l-2 border-l-primary" 
                            : "hover:bg-muted/50"
                        }`}
                      >
                        {/* File Name & Path */}
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="mt-0.5 flex-shrink-0">
                            {getFileIcon(file.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className={`font-medium truncate ${isSelected ? "text-primary" : ""}`}>
                                  {file.name}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-md">
                                <p className="font-mono text-xs break-all">{file.name}</p>
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="text-xs text-muted-foreground truncate">
                                  {cleanPath}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="max-w-md">
                                <p className="font-mono text-xs break-all">{cleanPath}</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          {isSelected && (
                            <Check className="h-4 w-4 text-primary flex-shrink-0" />
                          )}
                        </div>
                        
                        {/* Size */}
                        <div className="text-sm text-right tabular-nums text-muted-foreground">
                          {formatBytes(file.size)}
                        </div>
                        
                        {/* Date */}
                        <div className="text-sm text-right text-muted-foreground">
                          {formatFileDate(file.modified)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Selected File Path */}
          {selectedFile && (
            <div className="space-y-1">
              <Label className="text-xs">Selected Path</Label>
              <div className="p-2 bg-muted rounded-md text-xs font-mono break-all text-muted-foreground">
                {selectedFile.full_path}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedFile}>
            Select File
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
