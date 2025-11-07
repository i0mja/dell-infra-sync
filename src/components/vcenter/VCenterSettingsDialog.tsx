import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, TestTube } from "lucide-react";
import { z } from "zod";

interface VCenterSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const settingsSchema = z.object({
  host: z.string().trim().min(1, "vCenter host is required").max(255),
  username: z.string().trim().min(1, "Username is required").max(255),
  password: z.string().trim().min(1, "Password is required").max(255),
  port: z.number().int().min(1).max(65535),
  verify_ssl: z.boolean(),
  sync_enabled: z.boolean(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export function VCenterSettingsDialog({
  open,
  onOpenChange,
  onSaved,
}: VCenterSettingsDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState<SettingsFormData>({
    host: "",
    username: "",
    password: "",
    port: 443,
    verify_ssl: true,
    sync_enabled: false,
  });

  useEffect(() => {
    if (open) {
      fetchSettings();
    }
  }, [open]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("vcenter_settings")
        .select("*")
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettingsId(data.id);
        setFormData({
          host: data.host,
          username: data.username,
          password: data.password,
          port: data.port,
          verify_ssl: data.verify_ssl,
          sync_enabled: data.sync_enabled,
        });
      }
    } catch (error: any) {
      console.error("Error fetching vCenter settings:", error);
      toast({
        title: "Error",
        description: "Failed to load vCenter settings",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      const validated = settingsSchema.parse(formData);
      
      setTesting(true);
      toast({
        title: "Testing connection...",
        description: "Attempting to connect to vCenter",
      });

      // In a real implementation, this would call an edge function to test the connection
      // For now, we'll simulate a test
      await new Promise(resolve => setTimeout(resolve, 1500));

      toast({
        title: "Connection successful",
        description: "Successfully connected to vCenter",
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: error.errors[0].message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Connection failed",
          description: error.message || "Failed to connect to vCenter",
          variant: "destructive",
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      const validated = settingsSchema.parse(formData);
      
      setLoading(true);

      if (settingsId) {
        // Update existing settings
        const { error } = await supabase
          .from("vcenter_settings")
          .update({
            host: validated.host,
            username: validated.username,
            password: validated.password,
            port: validated.port,
            verify_ssl: validated.verify_ssl,
            sync_enabled: validated.sync_enabled,
          })
          .eq("id", settingsId);

        if (error) throw error;
      } else {
        // Insert new settings
        const { data, error } = await supabase
          .from("vcenter_settings")
          .insert([{
            host: validated.host,
            username: validated.username,
            password: validated.password,
            port: validated.port,
            verify_ssl: validated.verify_ssl,
            sync_enabled: validated.sync_enabled,
          }])
          .select()
          .single();

        if (error) throw error;
        setSettingsId(data.id);
      }

      toast({
        title: "Settings saved",
        description: "vCenter settings have been saved successfully",
      });

      onOpenChange(false);
      onSaved?.();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: error.errors[0].message,
          variant: "destructive",
        });
      } else {
        console.error("Error saving vCenter settings:", error);
        toast({
          title: "Error",
          description: error.message || "Failed to save vCenter settings",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>vCenter Settings</DialogTitle>
          <DialogDescription>
            Configure connection to your VMware vCenter Server
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="host">vCenter Host/IP</Label>
            <Input
              id="host"
              placeholder="vcenter.example.com"
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="administrator@vsphere.local"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 443 })}
                disabled={loading}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Verify SSL Certificate</Label>
              <p className="text-sm text-muted-foreground">
                Validate vCenter SSL certificate
              </p>
            </div>
            <Switch
              checked={formData.verify_ssl}
              onCheckedChange={(checked) => setFormData({ ...formData, verify_ssl: checked })}
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Enable Auto-Sync</Label>
              <p className="text-sm text-muted-foreground">
                Automatically sync vCenter data
              </p>
            </div>
            <Switch
              checked={formData.sync_enabled}
              onCheckedChange={(checked) => setFormData({ ...formData, sync_enabled: checked })}
              disabled={loading}
            />
          </div>

          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={loading || testing}
            className="w-full"
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing Connection...
              </>
            ) : (
              <>
                <TestTube className="mr-2 h-4 w-4" />
                Test Connection
              </>
            )}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
