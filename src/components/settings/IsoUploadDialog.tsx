import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, X, HardDrive, Loader2 } from "lucide-react";
import { useIsoImages } from "@/hooks/useIsoImages";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface IsoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const IsoUploadDialog = ({ open, onOpenChange }: IsoUploadDialogProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { startUpload } = useIsoImages();
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.iso')) {
      toast({
        title: "Invalid File",
        description: "Please select an ISO file",
        variant: "destructive",
      });
      return;
    }

    // Check file size (warn if > 8GB)
    const sizeGB = file.size / (1024 * 1024 * 1024);
    if (sizeGB > 8) {
      toast({
        title: "Large File",
        description: `This ${sizeGB.toFixed(1)} GB file will take some time to upload`,
      });
    }

    setSelectedFile(file);
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    try {
      // Read file as base64
      const reader = new FileReader();
      
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 50)); // First 50% is reading
        }
      };

      const fileData = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const base64 = reader.result as string;
          const base64Data = base64.split(',')[1]; // Remove data:... prefix
          resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(selectedFile);
      });

      setUploadProgress(50);

      // Start upload job
      const { isoImageId, jobId } = await startUpload({
        filename: selectedFile.name,
        fileSize: selectedFile.size,
        description,
        tags,
        isoData: fileData,
      });

      setUploadProgress(75);

      // Poll job status
      const pollInterval = setInterval(async () => {
        const { data: job } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', jobId)
          .single();

        if (job?.status === 'completed') {
          clearInterval(pollInterval);
          setUploadProgress(100);
          
          toast({
            title: "Upload Complete",
            description: "ISO is ready for use",
          });
          
          // Reset form
          setSelectedFile(null);
          setDescription("");
          setTags([]);
          setUploading(false);
          onOpenChange(false);
        } else if (job?.status === 'failed') {
          clearInterval(pollInterval);
          const details = job.details as any;
          throw new Error(details?.error || "Upload failed");
        } else {
          // Update progress based on job details
          const details = job?.details as any;
          const progress = details?.progress || 75;
          setUploadProgress(Math.min(progress, 95));
        }
      }, 2000);

      // Timeout after 10 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (uploading) {
          toast({
            title: "Upload Timeout",
            description: "Check job status in Maintenance Planner",
            variant: "destructive",
          });
          setUploading(false);
        }
      }, 600000);

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload ISO Image</DialogTitle>
          <DialogDescription>
            Upload an ISO image to the Job Executor for virtual media mounting
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Selection */}
          <div className="space-y-2">
            <Label>ISO File *</Label>
            <div 
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {selectedFile ? (
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <HardDrive className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                    </p>
                  </div>
                  {!uploading && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="font-medium">Click to select ISO file</p>
                  <p className="text-sm text-muted-foreground">Or drag and drop</p>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".iso"
              className="hidden"
              onChange={handleFileSelect}
              disabled={uploading}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="e.g., Ubuntu 22.04 LTS Server ISO"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={uploading}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
                placeholder="Add tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                disabled={uploading}
              />
              <Button
                variant="outline"
                onClick={handleAddTag}
                disabled={!tagInput.trim() || uploading}
              >
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                      disabled={uploading}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Upload Progress */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!selectedFile || uploading}>
              {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Upload ISO
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
