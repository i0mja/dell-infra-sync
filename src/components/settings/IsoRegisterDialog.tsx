import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { HardDrive, Link, Scan, X, Loader2, Info } from "lucide-react";
import { useIsoImages } from "@/hooks/useIsoImages";
import { Checkbox } from "@/components/ui/checkbox";

interface IsoRegisterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const IsoRegisterDialog = ({ open, onOpenChange }: IsoRegisterDialogProps) => {
  const [isoUrl, setIsoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [downloadLocal, setDownloadLocal] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { scanLocalIsos, registerIsoUrl } = useIsoImages();

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter(t => t !== tag));
  };

  const handleScanDirectory = async () => {
    setLoading(true);
    try {
      await scanLocalIsos();
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterUrl = async () => {
    if (!isoUrl) return;
    
    setLoading(true);
    try {
      await registerIsoUrl({
        isoUrl,
        description,
        tags,
        downloadLocal,
      });
      
      // Reset form
      setIsoUrl("");
      setDescription("");
      setTags([]);
      setDownloadLocal(false);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Register ISO Image</DialogTitle>
          <DialogDescription>
            Add ISO images for virtual media mounting in your offline environment
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="scan" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="scan">
              <Scan className="h-4 w-4 mr-2" />
              Scan Directory
            </TabsTrigger>
            <TabsTrigger value="url">
              <Link className="h-4 w-4 mr-2" />
              Register URL
            </TabsTrigger>
          </TabsList>

          {/* Scan ISO Directory Tab */}
          <TabsContent value="scan" className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">Place ISO files on the Job Executor host:</p>
                  <code className="block bg-muted/50 px-3 py-2 rounded text-sm">
                    /var/lib/idrac-manager/isos/
                  </code>
                  <p className="text-sm text-muted-foreground">
                    Then click "Scan for ISOs" below to register all .iso files found in that directory.
                  </p>
                </div>
              </AlertDescription>
            </Alert>

            <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/30">
              <div className="flex-shrink-0 h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <HardDrive className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Scan Local ISO Directory</p>
                <p className="text-sm text-muted-foreground">
                  Discovers and registers all ISOs from the Job Executor
                </p>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleScanDirectory} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Scan className="mr-2 h-4 w-4" />
                Scan for ISOs
              </Button>
            </div>
          </TabsContent>

          {/* Register from URL Tab */}
          <TabsContent value="url" className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Register an ISO from an HTTP/HTTPS URL on your network (e.g., file server, NAS).
              </AlertDescription>
            </Alert>

            {/* ISO URL */}
            <div className="space-y-2">
              <Label htmlFor="iso-url">ISO URL *</Label>
              <Input
                id="iso-url"
                placeholder="http://fileserver.local/isos/ubuntu-22.04.iso"
                value={isoUrl}
                onChange={(e) => setIsoUrl(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* Download Local Option */}
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="download-local" 
                checked={downloadLocal}
                onCheckedChange={(checked) => setDownloadLocal(checked as boolean)}
                disabled={loading}
              />
              <Label 
                htmlFor="download-local"
                className="text-sm font-normal cursor-pointer"
              >
                Download to Job Executor (recommended for reliability)
              </Label>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="url-description">Description</Label>
              <Textarea
                id="url-description"
                placeholder="e.g., Ubuntu 22.04 LTS Server ISO"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="url-tags">Tags</Label>
              <div className="flex gap-2">
                <Input
                  id="url-tags"
                  placeholder="Add tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  disabled={loading}
                />
                <Button
                  variant="outline"
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || loading}
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
                        disabled={loading}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleRegisterUrl} disabled={!isoUrl || loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Register ISO
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
