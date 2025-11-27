import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, X } from "lucide-react";
import { useFirmwarePackages } from "@/hooks/useFirmwarePackages";
import { toast } from "sonner";

interface FirmwareUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const componentTypes = ["BIOS", "iDRAC", "NIC", "RAID", "Drivers", "Other"];
const criticalityLevels = ["Critical", "Recommended", "Optional"];

export function FirmwareUploadDialog({ open, onOpenChange }: FirmwareUploadDialogProps) {
  const { startUpload } = useFirmwarePackages();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState({
    component_type: "BIOS",
    dell_version: "",
    applicable_models: "",
    criticality: "Optional",
    reboot_required: true,
    description: "",
    tags: "",
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.exe')) {
        toast.error("Please select a Dell Update Package (.exe) file");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      toast.error("Please select a file to upload");
      return;
    }

    if (!formData.dell_version) {
      toast.error("Please enter the Dell version");
      return;
    }

    setUploading(true);

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target?.result as string;
        const base64Content = base64Data.split(',')[1]; // Remove data:application/octet-stream;base64,

        await startUpload.mutateAsync({
          filename: selectedFile.name,
          file_size_bytes: selectedFile.size,
          component_type: formData.component_type,
          dell_version: formData.dell_version,
          applicable_models: formData.applicable_models ? formData.applicable_models.split(',').map(m => m.trim()) : [],
          criticality: formData.criticality,
          reboot_required: formData.reboot_required,
          description: formData.description || undefined,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
          file_data_base64: base64Content,
        });

        onOpenChange(false);
        resetForm();
      };

      reader.onerror = () => {
        toast.error("Failed to read file");
        setUploading(false);
      };

      reader.readAsDataURL(selectedFile);
    } catch (error) {
      console.error("Upload error:", error);
      setUploading(false);
    }
  };

  const resetForm = () => {
    setSelectedFile(null);
    setFormData({
      component_type: "BIOS",
      dell_version: "",
      applicable_models: "",
      criticality: "Optional",
      reboot_required: true,
      description: "",
      tags: "",
    });
    setUploading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Firmware Package</DialogTitle>
          <DialogDescription>
            Upload a Dell Update Package (.exe) to the local firmware repository
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File selector */}
          <div className="space-y-2">
            <Label>Firmware File (.exe)</Label>
            <div className="flex gap-2">
              <Input
                type="file"
                accept=".exe"
                onChange={handleFileSelect}
                disabled={uploading}
                className="flex-1"
              />
              {selectedFile && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedFile(null)}
                  disabled={uploading}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedFile && (
              <p className="text-sm text-muted-foreground">
                {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </p>
            )}
          </div>

          {/* Component type */}
          <div className="space-y-2">
            <Label htmlFor="component_type">Component Type</Label>
            <Select
              value={formData.component_type}
              onValueChange={(value) => setFormData({ ...formData, component_type: value })}
              disabled={uploading}
            >
              <SelectTrigger id="component_type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {componentTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Version */}
          <div className="space-y-2">
            <Label htmlFor="dell_version">Dell Version *</Label>
            <Input
              id="dell_version"
              value={formData.dell_version}
              onChange={(e) => setFormData({ ...formData, dell_version: e.target.value })}
              placeholder="e.g., 2.19.1"
              disabled={uploading}
              required
            />
          </div>

          {/* Applicable models */}
          <div className="space-y-2">
            <Label htmlFor="applicable_models">Applicable Models (comma-separated)</Label>
            <Input
              id="applicable_models"
              value={formData.applicable_models}
              onChange={(e) => setFormData({ ...formData, applicable_models: e.target.value })}
              placeholder="e.g., PowerEdge R640, PowerEdge R740"
              disabled={uploading}
            />
          </div>

          {/* Criticality */}
          <div className="space-y-2">
            <Label htmlFor="criticality">Criticality</Label>
            <Select
              value={formData.criticality}
              onValueChange={(value) => setFormData({ ...formData, criticality: value })}
              disabled={uploading}
            >
              <SelectTrigger id="criticality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {criticalityLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description of the firmware package"
              disabled={uploading}
              rows={3}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              placeholder="e.g., production, tested, q4-2024"
              disabled={uploading}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Uploading..." : "Upload Firmware"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
