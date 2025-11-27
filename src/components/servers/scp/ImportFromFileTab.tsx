import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Upload, FileJson } from "lucide-react";
import { toast } from "sonner";

interface ImportFromFileTabProps {
  serverId: string;
}

export function ImportFromFileTab({ serverId }: ImportFromFileTabProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file: File) => {
    const validTypes = ["application/json", "text/xml", "application/xml"];
    if (!validTypes.includes(file.type) && !file.name.endsWith(".json") && !file.name.endsWith(".xml")) {
      toast.error("Invalid file type. Please upload a JSON or XML SCP file.");
      return;
    }

    setSelectedFile(file);
    toast.success(`File "${file.name}" selected`);
  };

  const handleImport = () => {
    if (!selectedFile) {
      toast.error("Please select a file first");
      return;
    }

    // TODO: Implement actual import logic
    toast.info("Import from file feature coming soon");
  };

  return (
    <div className="space-y-4">
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Upload an SCP backup file (JSON or XML format) to restore configuration to this server.
        </AlertDescription>
      </Alert>

      <Card
        className={`border-2 border-dashed transition-colors ${
          dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 space-y-4">
          <div className="rounded-full bg-primary/10 p-4">
            <FileJson className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center space-y-2">
            <p className="text-sm font-medium">Drag and drop your SCP file here</p>
            <p className="text-xs text-muted-foreground">or click to browse (JSON/XML files)</p>
          </div>
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".json,.xml"
            onChange={handleFileInput}
          />
          <Button variant="outline" onClick={() => document.getElementById("file-upload")?.click()}>
            Browse Files
          </Button>
          {selectedFile && (
            <div className="text-sm text-muted-foreground">
              Selected: <span className="font-medium">{selectedFile.name}</span> ({(selectedFile.size / 1024).toFixed(1)} KB)
            </div>
          )}
        </CardContent>
      </Card>

      {selectedFile && (
        <Button className="w-full" onClick={handleImport}>
          <Upload className="h-4 w-4 mr-2" />
          Import & Restore Configuration
        </Button>
      )}

      <Alert variant="default" className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-sm">
          <strong>Note:</strong> This feature is currently in development. Use the Backups Library tab to restore from existing backups.
        </AlertDescription>
      </Alert>
    </div>
  );
}
