import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Disc, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface VirtualMediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname: string | null;
  };
}

interface VirtualMediaSession {
  id: string;
  is_mounted: boolean;
  media_type: string;
  image_name: string;
  remote_image_url: string;
  mounted_at: string | null;
}

export const VirtualMediaDialog = ({ open, onOpenChange, server }: VirtualMediaDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [mediaType, setMediaType] = useState<'CD' | 'DVD' | 'USBStick' | 'Floppy'>('CD');
  const [writeProtected, setWriteProtected] = useState(true);
  const [currentSession, setCurrentSession] = useState<VirtualMediaSession | null>(null);
  const [fetchingStatus, setFetchingStatus] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (open && server.id) {
      fetchCurrentSession();
    }
  }, [open, server.id]);

  const fetchCurrentSession = async () => {
    try {
      setFetchingStatus(true);
      const { data, error } = await supabase
        .from('virtual_media_sessions')
        .select('*')
        .eq('server_id', server.id)
        .eq('is_mounted', true)
        .order('mounted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      setCurrentSession(data);
    } catch (error: any) {
      console.error('Error fetching virtual media status:', error);
    } finally {
      setFetchingStatus(false);
    }
  };

  const handleMount = async () => {
    if (!imageUrl) {
      toast({
        title: "Error",
        description: "Please enter an ISO image URL",
        variant: "destructive",
      });
      return;
    }

    if (!imageName) {
      toast({
        title: "Error",
        description: "Please enter an image name",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Create virtual media session record
      const { data: sessionData, error: sessionError } = await supabase
        .from('virtual_media_sessions')
        .insert({
          server_id: server.id,
          media_type: mediaType,
          image_name: imageName,
          remote_image_url: imageUrl,
          write_protected: writeProtected,
          is_mounted: false,
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Create mount job
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'virtual_media_mount',
          status: 'pending',
          created_by: user!.id,
          target_scope: {
            server_ids: [server.id]
          },
          details: {
            session_id: sessionData.id,
            image_url: imageUrl,
            media_type: mediaType,
            write_protected: writeProtected,
            notes: `Mount ${imageName}`
          }
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Update session with mount job ID
      await supabase
        .from('virtual_media_sessions')
        .update({ mount_job_id: jobData.id })
        .eq('id', sessionData.id);

      toast({
        title: "Mount Job Created",
        description: `Virtual media mount job created. Check Jobs page for status.`,
      });

      // Refresh status after a delay
      setTimeout(() => {
        fetchCurrentSession();
      }, 3000);

      // Clear form
      setImageUrl("");
      setImageName("");
    } catch (error: any) {
      console.error('Error mounting virtual media:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create mount job",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUnmount = async () => {
    if (!currentSession) return;

    setLoading(true);

    try {
      // Create unmount job
      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'virtual_media_unmount',
          status: 'pending',
          created_by: user!.id,
          target_scope: {
            server_ids: [server.id]
          },
          details: {
            session_id: currentSession.id,
            media_type: currentSession.media_type,
            notes: `Unmount ${currentSession.image_name}`
          }
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Update session with unmount job ID
      await supabase
        .from('virtual_media_sessions')
        .update({ unmount_job_id: jobData.id })
        .eq('id', currentSession.id);

      toast({
        title: "Unmount Job Created",
        description: `Virtual media unmount job created. Check Jobs page for status.`,
      });

      // Refresh status after a delay
      setTimeout(() => {
        fetchCurrentSession();
      }, 3000);
    } catch (error: any) {
      console.error('Error unmounting virtual media:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to create unmount job",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Disc className="h-5 w-5" />
            Virtual Media Management
          </DialogTitle>
          <DialogDescription>
            Mount ISO images to {server.hostname || server.ip_address} via iDRAC virtual media
          </DialogDescription>
        </DialogHeader>

        {fetchingStatus ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Current Status */}
            {currentSession ? (
              <Alert>
                <Disc className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Currently Mounted:</p>
                      <p className="text-sm">{currentSession.image_name}</p>
                      <p className="text-xs text-muted-foreground">{currentSession.remote_image_url}</p>
                      <Badge variant="outline" className="mt-1">
                        {currentSession.media_type}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleUnmount}
                      disabled={loading}
                    >
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Unmount
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <AlertDescription>
                  No virtual media currently mounted
                </AlertDescription>
              </Alert>
            )}

            {/* Mount Form */}
            <div className="space-y-4 border-t pt-4">
              <h4 className="font-medium">Mount New Virtual Media</h4>
              
              <div className="space-y-2">
                <Label htmlFor="imageName">Image Name *</Label>
                <Input
                  id="imageName"
                  placeholder="e.g., Ubuntu 22.04 Live ISO"
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="imageUrl">Image URL *</Label>
                <Input
                  id="imageUrl"
                  placeholder="http://192.168.1.100/isos/ubuntu-22.04.iso"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">
                  HTTP/HTTPS/NFS/CIFS URL accessible from the iDRAC network
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mediaType">Media Type</Label>
                  <Select
                    value={mediaType}
                    onValueChange={(value) => setMediaType(value as any)}
                    disabled={loading}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CD">CD/DVD</SelectItem>
                      <SelectItem value="USBStick">USB Stick</SelectItem>
                      <SelectItem value="Floppy">Floppy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="writeProtected" className="flex items-center justify-between">
                    Write Protected
                    <Switch
                      id="writeProtected"
                      checked={writeProtected}
                      onCheckedChange={setWriteProtected}
                      disabled={loading}
                    />
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Prevent writes to the virtual media
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleMount}
            disabled={loading || fetchingStatus || !imageUrl || !imageName}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mount Virtual Media
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
