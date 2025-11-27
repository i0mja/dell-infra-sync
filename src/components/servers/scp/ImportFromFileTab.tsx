import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Upload, FileJson, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { parseScpFile, calculateChecksum, type ScpParseResult } from "@/lib/scp-parser";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ImportFromFileTabProps {
  serverId: string;
  onImportStarted?: () => void;
}

export function ImportFromFileTab({ serverId, onImportStarted }: ImportFromFileTabProps) {
  const { user } = useAuth();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [parseResult, setParseResult] = useState<ScpParseResult | null>(null);
  const [importing, setImporting] = useState(false);

  // Import options
  const [includeBios, setIncludeBios] = useState(true);
  const [includeIdrac, setIncludeIdrac] = useState(true);
  const [includeNic, setIncludeNic] = useState(true);
  const [includeRaid, setIncludeRaid] = useState(true);
  const [shutdownType, setShutdownType] = useState("Graceful");
  const [hostPowerState, setHostPowerState] = useState("On");

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

  const handleFile = async (file: File) => {
    // Validate file type
    const validTypes = ["application/json", "text/xml", "application/xml"];
    const isValidType = validTypes.includes(file.type) || 
                       file.name.endsWith(".json") || 
                       file.name.endsWith(".xml");
    
    if (!isValidType) {
      toast.error("Invalid file type. Please upload a JSON or XML SCP file.");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Maximum size is 10MB.");
      return;
    }

    setSelectedFile(file);
    
    // Read file content
    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      setFileContent(content);
      
      // Parse and validate
      toast.loading("Parsing SCP file...");
      const result = await parseScpFile(content, file.name);
      toast.dismiss();
      
      if (result.valid) {
        setParseResult(result);
        
        // Set default component selections based on what's detected
        setIncludeBios(result.detectedComponents.hasBios);
        setIncludeIdrac(result.detectedComponents.hasIdrac);
        setIncludeNic(result.detectedComponents.hasNic);
        setIncludeRaid(result.detectedComponents.hasRaid);
        
        toast.success(`Valid SCP file loaded: ${file.name}`);
      } else {
        setParseResult(result);
        toast.error(result.error || "Invalid SCP file");
      }
    };
    
    reader.onerror = () => {
      toast.error("Failed to read file");
    };
    
    reader.readAsText(file);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setFileContent("");
    setParseResult(null);
  };

  const handleImport = async () => {
    if (!selectedFile || !parseResult?.valid || !parseResult.content || !user) {
      toast.error("No valid file selected");
      return;
    }

    // Check if at least one component is selected
    if (!includeBios && !includeIdrac && !includeNic && !includeRaid) {
      toast.error("Please select at least one component to import");
      return;
    }

    setImporting(true);

    try {
      // Calculate checksum
      const checksum = await calculateChecksum(fileContent);

      // Insert backup record into database
      const { data: backup, error: backupError } = await supabase
        .from("scp_backups")
        .insert({
          server_id: serverId,
          backup_name: `Imported: ${selectedFile.name}`,
          description: `Imported from file on ${new Date().toLocaleString()}`,
          scp_content: parseResult.content,
          scp_raw_content: fileContent,  // Store original content for import
          scp_format: parseResult.format,  // Store original format (JSON or XML)
          scp_file_size_bytes: selectedFile.size,
          checksum: checksum,
          include_bios: includeBios,
          include_idrac: includeIdrac,
          include_nic: includeNic,
          include_raid: includeRaid,
          is_valid: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (backupError) throw backupError;

      // Create import job
      const { data: job, error: jobError } = await supabase.functions.invoke("create-job", {
        body: {
          job_type: "scp_import",
          target_scope: { server_ids: [serverId] },
          details: {
            backup_id: backup.id,
            shutdown_type: shutdownType,
            host_power_state: hostPowerState,
            include_bios: includeBios,
            include_idrac: includeIdrac,
            include_nic: includeNic,
            include_raid: includeRaid,
          },
        },
      });

      if (jobError) throw jobError;

      toast.success("Import job created successfully");
      
      // Clear form
      handleClear();
      
      // Notify parent to refresh
      onImportStarted?.();
    } catch (error) {
      console.error("Import error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create import job");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Upload an SCP backup file (JSON or XML format) to restore configuration to this server.
        </AlertDescription>
      </Alert>

      {!parseResult && (
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
            {selectedFile && !parseResult && (
              <div className="text-sm text-muted-foreground">
                Loading: <span className="font-medium">{selectedFile.name}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {parseResult && (
        <Card className={parseResult.valid ? "border-green-500" : "border-destructive"}>
          <CardContent className="pt-6 space-y-4">
            {/* File status */}
            <div className="flex items-start gap-3">
              {parseResult.valid ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-medium">
                  {parseResult.valid ? "Valid SCP File" : "Invalid SCP File"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedFile?.name} ({(selectedFile!.size / 1024).toFixed(1)} KB)
                </p>
                {!parseResult.valid && parseResult.error && (
                  <p className="text-sm text-destructive mt-1">{parseResult.error}</p>
                )}
              </div>
            </div>

            {parseResult.valid && parseResult.metadata && (
              <div className="space-y-2 pl-8">
                {parseResult.metadata.model && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-muted-foreground">Model:</span>
                    <span className="font-medium">{parseResult.metadata.model}</span>
                  </div>
                )}
                {parseResult.metadata.serviceTag && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-muted-foreground">Service Tag:</span>
                    <span className="font-medium">{parseResult.metadata.serviceTag}</span>
                  </div>
                )}
                {parseResult.metadata.timestamp && (
                  <div className="flex gap-2 text-sm">
                    <span className="text-muted-foreground">Exported:</span>
                    <span className="font-medium">{new Date(parseResult.metadata.timestamp).toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}

            {/* Component selection */}
            {parseResult.valid && (
              <div className="space-y-3 pl-8">
                <p className="text-sm font-medium">Detected Components:</p>
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="bios" 
                      checked={includeBios}
                      onCheckedChange={(checked) => setIncludeBios(!!checked)}
                      disabled={!parseResult.detectedComponents.hasBios}
                    />
                    <Label htmlFor="bios" className="text-sm font-normal cursor-pointer">
                      BIOS {parseResult.detectedComponents.hasBios 
                        ? `(${parseResult.detectedComponents.biosCount} attributes)` 
                        : "(not present in file)"}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="idrac" 
                      checked={includeIdrac}
                      onCheckedChange={(checked) => setIncludeIdrac(!!checked)}
                      disabled={!parseResult.detectedComponents.hasIdrac}
                    />
                    <Label htmlFor="idrac" className="text-sm font-normal cursor-pointer">
                      iDRAC {parseResult.detectedComponents.hasIdrac 
                        ? `(${parseResult.detectedComponents.idracCount} attributes)` 
                        : "(not present in file)"}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="nic" 
                      checked={includeNic}
                      onCheckedChange={(checked) => setIncludeNic(!!checked)}
                      disabled={!parseResult.detectedComponents.hasNic}
                    />
                    <Label htmlFor="nic" className="text-sm font-normal cursor-pointer">
                      NIC {parseResult.detectedComponents.hasNic 
                        ? `(${parseResult.detectedComponents.nicCount} attributes)` 
                        : "(not present in file)"}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="raid" 
                      checked={includeRaid}
                      onCheckedChange={(checked) => setIncludeRaid(!!checked)}
                      disabled={!parseResult.detectedComponents.hasRaid}
                    />
                    <Label htmlFor="raid" className="text-sm font-normal cursor-pointer">
                      RAID {parseResult.detectedComponents.hasRaid 
                        ? `(${parseResult.detectedComponents.raidCount} attributes)` 
                        : "(not present in file)"}
                    </Label>
                  </div>
                </div>
              </div>
            )}

            {/* Import options */}
            {parseResult.valid && (
              <div className="space-y-3 pt-4 border-t">
                <p className="text-sm font-medium">Restore Options:</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="shutdown-type" className="text-sm">Shutdown Type</Label>
                    <Select value={shutdownType} onValueChange={setShutdownType}>
                      <SelectTrigger id="shutdown-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Graceful">Graceful</SelectItem>
                        <SelectItem value="Forced">Forced</SelectItem>
                        <SelectItem value="NoReboot">No Reboot</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="power-state" className="text-sm">After Import</Label>
                    <Select value={hostPowerState} onValueChange={setHostPowerState}>
                      <SelectTrigger id="power-state">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="On">Power On</SelectItem>
                        <SelectItem value="Off">Power Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Warning */}
            {parseResult.valid && (
              <Alert variant="default" className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-amber-900 dark:text-amber-200">
                  <strong>Warning:</strong> The server may reboot multiple times during this operation. Ensure no critical workloads are running.
                </AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={handleClear} disabled={importing}>
                Clear
              </Button>
              {parseResult.valid && (
                <Button onClick={handleImport} disabled={importing}>
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Import Job...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Import & Restore Configuration
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
