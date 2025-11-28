import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, FolderOpen, FileArchive } from "lucide-react";
import { useVCenters } from "@/hooks/useVCenters";
import { useVCenterData } from "@/hooks/useVCenterData";
import { useDatastoreBrowser, DatastoreFile } from "@/hooks/useDatastoreBrowser";
import { formatBytes } from "@/lib/utils";

interface DatastoreBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSelect: (file: DatastoreFile, datastoreName: string) => void;
  filePatterns?: string[];
}

export function DatastoreBrowserDialog({
  open,
  onOpenChange,
  onFileSelect,
  filePatterns = ["*.zip", "*.iso"],
}: DatastoreBrowserDialogProps) {
  const { vcenters } = useVCenters();
  const [selectedVCenterId, setSelectedVCenterId] = useState<string>("");
  const [selectedDatastoreName, setSelectedDatastoreName] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<DatastoreFile | null>(null);

  const { datastores } = useVCenterData(selectedVCenterId);
  const { browsing, files, browseDatastore } = useDatastoreBrowser();

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
                        {ds.capacity_bytes && formatBytes(ds.capacity_bytes)}
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
              <Label>
                Files (showing {filePatterns.join(", ")}):
              </Label>
              <ScrollArea className="h-[300px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {files.map((file, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedFile(file)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left ${
                        selectedFile?.full_path === file.full_path ? "bg-accent" : ""
                      }`}
                    >
                      <FileArchive className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{file.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {file.folder}
                        </div>
                      </div>
                      <div className="flex flex-col items-end text-xs text-muted-foreground">
                        <span>{formatBytes(file.size)}</span>
                        {file.modified && (
                          <span>{new Date(file.modified).toLocaleDateString()}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                {files.length} file(s) found
              </p>
            </div>
          )}

          {/* Selected File Path */}
          {selectedFile && (
            <div className="space-y-2">
              <Label>Selected Path</Label>
              <div className="p-3 bg-muted rounded-lg text-sm font-mono break-all">
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
