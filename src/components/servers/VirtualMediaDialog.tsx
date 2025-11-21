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
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const [shareDefaults, setShareDefaults] = useState<any | null>(null);
  const [loadingShareDefaults, setLoadingShareDefaults] = useState(false);
  const [browsingShare, setBrowsingShare] = useState(false);
  const [browseModalOpen, setBrowseModalOpen] = useState(false);
  const [shareFiles, setShareFiles] = useState<string[]>([]);
  const [shareBaseUrl, setShareBaseUrl] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const buildShareUrl = (settings: any) => {
    if (!settings?.host) return "";
    const scheme = settings.share_type || 'nfs';
    const cleanExport = (settings.export_path || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const cleanIso = (settings.iso_path || "").replace(/^\/+/, "").replace(/\/+$/, "");
    const path = [cleanExport, cleanIso].filter(Boolean).join("/");
    return `${scheme}://${settings.host}${path ? `/${path}` : ""}`;
  };

  useEffect(() => {
    if (open && server.id) {
      fetchCurrentSession();
      loadShareDefaults();
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

  const loadShareDefaults = async () => {
    try {
      setLoadingShareDefaults(true);
      const { data } = await supabase
        .from('virtual_media_settings' as any)
        .select('*')
        .limit(1)
        .maybeSingle();

      if (data) {
        setShareDefaults(data);
        const baseUrl = buildShareUrl(data);
        setShareBaseUrl(baseUrl || null);
        if (!imageUrl && baseUrl) {
          setImageUrl(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
        }
      }
    } catch (error) {
      console.error('Error loading virtual media defaults', error);
    } finally {
      setLoadingShareDefaults(false);
    }
  };

  const handleBrowseShare = async () => {
    if (!shareDefaults?.host) {
      toast({
        title: "Configure virtual media settings",
        description: "Add a share host in Settings → Virtual Media first",
        variant: "destructive",
      });
      return;
    }

    setBrowsingShare(true);
    setBrowseError(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-virtual-media-share', {
        body: {
          host: shareDefaults.host,
          export_path: shareDefaults.export_path,
          iso_path: shareDefaults.iso_path,
          share_type: shareDefaults.share_type,
          username: shareDefaults.use_auth ? shareDefaults.username : undefined,
          password: shareDefaults.use_auth ? shareDefaults.password : undefined,
          list_files: true,
        }
      });

      if (error) throw error;

      const baseUrl = data?.base_url || buildShareUrl(shareDefaults);
      setShareBaseUrl(baseUrl);
      setShareFiles(data?.files || []);
      setBrowseError(data?.listing_error || (!data?.success ? data?.error : null));
      setBrowseModalOpen(true);

      if (!data?.files?.length && !data?.listing_error) {
        toast({
          title: "No images discovered",
          description: "Share responded but no .iso/.img files were listed",
        });
      }
    } catch (error: any) {
      console.error('Error browsing virtual media share:', error);
      setBrowseError(error.message || 'Unable to browse share');
      setBrowseModalOpen(true);
    } finally {
      setBrowsingShare(false);
    }
  };

  const handleSelectShareFile = (file: string) => {
    const baseUrl = shareBaseUrl || buildShareUrl(shareDefaults);
    if (!baseUrl) return;
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const trimmedFile = file.replace(/^\/+/, '');
    const selectedUrl = `${normalizedBase}${trimmedFile}`;
    setImageUrl(selectedUrl);
    if (!imageName) {
      const fileNameOnly = trimmedFile.split('/').pop();
      if (fileNameOnly) setImageName(fileNameOnly);
    }
    setBrowseModalOpen(false);
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
        description: `Virtual media mount job created. Check Maintenance Planner → Jobs for status.`,
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
        description: `Virtual media unmount job created. Check Maintenance Planner → Jobs for status.`,
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
    <>
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
                <Label htmlFor="imageUrl" className="flex items-center justify-between gap-2">
                  Image URL *
                  {shareBaseUrl && (
                    <Badge variant="outline" className="text-xs">
                      Default: {shareBaseUrl}
                    </Badge>
                  )}
                </Label>
                <div className="flex flex-col gap-2 md:flex-row">
                  <Input
                    id="imageUrl"
                    placeholder="http://192.168.1.100/isos/ubuntu-22.04.iso"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    disabled={loading}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBrowseShare}
                    disabled={loadingShareDefaults || browsingShare}
                  >
                    {(loadingShareDefaults || browsingShare) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Browse share
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  HTTP/HTTPS/NFS/CIFS URL accessible from the iDRAC network
                </p>
                {shareDefaults && (
                  <p className="text-xs text-muted-foreground">
                    Prefilled from Settings → Virtual Media ({shareDefaults.host})
                  </p>
                )}
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

      <Dialog open={browseModalOpen} onOpenChange={setBrowseModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Browse virtual media share</DialogTitle>
            <DialogDescription>
              Select an ISO or image from the configured share to prefill the mount form.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {shareBaseUrl && (
              <p className="text-sm text-muted-foreground">
                Base URL: {shareBaseUrl}
              </p>
            )}

            {browseError && (
              <Alert variant="destructive">
                <AlertDescription>{browseError}</AlertDescription>
              </Alert>
            )}

            <ScrollArea className="h-64 rounded-md border p-3">
              {shareFiles.length > 0 ? (
                <div className="space-y-2">
                  {shareFiles.map((file) => (
                    <Button
                      key={file}
                      variant="ghost"
                      className="w-full justify-start font-mono"
                      onClick={() => handleSelectShareFile(file)}
                    >
                      <Disc className="mr-2 h-4 w-4" />
                      {file}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {browseError || 'No images available on the configured share.'}
                </p>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
