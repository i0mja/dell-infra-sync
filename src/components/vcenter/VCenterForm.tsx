import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import type { VCenterFormData } from "@/hooks/useVCenters";

interface VCenterFormProps {
  initialData?: Partial<VCenterFormData>;
  onSubmit: (data: VCenterFormData) => Promise<boolean>;
  onCancel: () => void;
  submitLabel?: string;
}

const vCenterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(255),
  datacenter_location: z.string().trim().max(255).optional(),
  host: z.string().trim().min(1, "vCenter host is required").max(255),
  username: z.string().trim().min(1, "Username is required").max(255),
  password: z.string().trim().min(1, "Password is required").max(255),
  port: z.number().int().min(1).max(65535),
  verify_ssl: z.boolean(),
  sync_enabled: z.boolean(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  is_primary: z.boolean().optional(),
});

export function VCenterForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = "Save",
}: VCenterFormProps) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<VCenterFormData>({
    name: initialData?.name ?? "",
    datacenter_location: initialData?.datacenter_location ?? "",
    host: initialData?.host ?? "",
    username: initialData?.username ?? "",
    password: initialData?.password ?? "",
    port: initialData?.port ?? 443,
    verify_ssl: initialData?.verify_ssl ?? true,
    sync_enabled: initialData?.sync_enabled ?? true,
    color: initialData?.color ?? "#6366f1",
    is_primary: initialData?.is_primary ?? false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const validated = vCenterSchema.parse(formData) as VCenterFormData;
      setLoading(true);
      const success = await onSubmit(validated);
      if (success) {
        onCancel();
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(newErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder="DC1 Production"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={loading}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="datacenter_location">Location</Label>
            <Input
              id="datacenter_location"
              placeholder="US-East"
              value={formData.datacenter_location}
              onChange={(e) => setFormData({ ...formData, datacenter_location: e.target.value })}
              disabled={loading}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="host">vCenter Host/IP *</Label>
          <Input
            id="host"
            placeholder="vcenter.example.com"
            value={formData.host}
            onChange={(e) => setFormData({ ...formData, host: e.target.value })}
            disabled={loading}
          />
          {errors.host && <p className="text-sm text-destructive">{errors.host}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="username">Username *</Label>
            <Input
              id="username"
              placeholder="administrator@vsphere.local"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              disabled={loading}
            />
            {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="port">Port *</Label>
            <Input
              id="port"
              type="number"
              value={formData.port}
              onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 443 })}
              disabled={loading}
            />
            {errors.port && <p className="text-sm text-destructive">{errors.port}</p>}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password *</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            disabled={loading}
          />
          {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="color">Color Tag</Label>
            <Input
              id="color"
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              disabled={loading}
              className="h-10"
            />
          </div>

          <div className="flex items-center justify-between pt-6">
            <Label htmlFor="is_primary">Primary vCenter</Label>
            <Switch
              id="is_primary"
              checked={formData.is_primary}
              onCheckedChange={(checked) => setFormData({ ...formData, is_primary: checked })}
              disabled={loading}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Verify SSL Certificate</Label>
            <p className="text-sm text-muted-foreground">Validate vCenter SSL certificate</p>
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
            <p className="text-sm text-muted-foreground">Automatically sync vCenter data</p>
          </div>
          <Switch
            checked={formData.sync_enabled}
            onCheckedChange={(checked) => setFormData({ ...formData, sync_enabled: checked })}
            disabled={loading}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </form>
  );
}
