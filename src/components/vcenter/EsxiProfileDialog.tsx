import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { FolderOpen } from "lucide-react";
import { EsxiUpgradeProfile, useEsxiProfiles } from "@/hooks/useEsxiProfiles";
import { DatastoreBrowserDialog } from "./DatastoreBrowserDialog";

interface EsxiProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editProfile?: EsxiUpgradeProfile | null;
}

export function EsxiProfileDialog({ open, onOpenChange, editProfile }: EsxiProfileDialogProps) {
  const { createProfile, updateProfile } = useEsxiProfiles();
  const [browseDialogOpen, setBrowseDialogOpen] = useState(false);
  
  const [formData, setFormData] = useState({
    name: "",
    target_version: "",
    bundle_path: "",
    profile_name: "",
    datastore_name: "",
    min_source_version: "",
    release_date: "",
    description: "",
    is_active: true,
  });

  useEffect(() => {
    if (editProfile) {
      setFormData({
        name: editProfile.name,
        target_version: editProfile.target_version,
        bundle_path: editProfile.bundle_path,
        profile_name: editProfile.profile_name,
        datastore_name: editProfile.datastore_name || "",
        min_source_version: editProfile.min_source_version || "",
        release_date: editProfile.release_date || "",
        description: editProfile.description || "",
        is_active: editProfile.is_active ?? true,
      });
    } else {
      setFormData({
        name: "",
        target_version: "",
        bundle_path: "",
        profile_name: "",
        datastore_name: "",
        min_source_version: "",
        release_date: "",
        description: "",
        is_active: true,
      });
    }
  }, [editProfile, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const profileData = {
      name: formData.name,
      target_version: formData.target_version,
      bundle_path: formData.bundle_path,
      profile_name: formData.profile_name,
      datastore_name: formData.datastore_name || null,
      min_source_version: formData.min_source_version || null,
      release_date: formData.release_date || null,
      description: formData.description || null,
      is_active: formData.is_active,
    };

    if (editProfile) {
      await updateProfile.mutateAsync({ id: editProfile.id, updates: profileData });
    } else {
      await createProfile.mutateAsync(profileData);
    }
    
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editProfile ? "Edit" : "Create"} ESXi Upgrade Profile</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Profile Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="ESXi 8.0 U3 Standard"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="target_version">Target Version *</Label>
              <Input
                id="target_version"
                required
                value={formData.target_version}
                onChange={(e) => setFormData({ ...formData, target_version: e.target.value })}
                placeholder="8.0.3"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bundle_path">Bundle Path *</Label>
            <div className="flex gap-2">
              <Input
                id="bundle_path"
                required
                value={formData.bundle_path}
                onChange={(e) => setFormData({ ...formData, bundle_path: e.target.value })}
                placeholder="/vmfs/volumes/shared-datastore/VMware-ESXi-8.0U3.zip"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setBrowseDialogOpen(true)}
              >
                <FolderOpen className="h-4 w-4 mr-1" />
                Browse
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile_name">Profile Name *</Label>
            <Input
              id="profile_name"
              required
              value={formData.profile_name}
              onChange={(e) => setFormData({ ...formData, profile_name: e.target.value })}
              placeholder="ESXi-8.0U3-24022510-standard"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="datastore_name">Datastore Name</Label>
              <Input
                id="datastore_name"
                value={formData.datastore_name}
                onChange={(e) => setFormData({ ...formData, datastore_name: e.target.value })}
                placeholder="shared-datastore"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="min_source_version">Minimum Source Version</Label>
              <Input
                id="min_source_version"
                value={formData.min_source_version}
                onChange={(e) => setFormData({ ...formData, min_source_version: e.target.value })}
                placeholder="7.0.0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="release_date">Release Date</Label>
            <Input
              id="release_date"
              type="date"
              value={formData.release_date}
              onChange={(e) => setFormData({ ...formData, release_date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="ESXi 8.0 Update 3 standard profile for production hosts"
              rows={3}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
            <Label htmlFor="is_active">Active Profile</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createProfile.isPending || updateProfile.isPending}>
              {editProfile ? "Update" : "Create"} Profile
            </Button>
          </DialogFooter>
        </form>
        
        <DatastoreBrowserDialog
          open={browseDialogOpen}
          onOpenChange={setBrowseDialogOpen}
          onFileSelect={(file, datastoreName) => {
            setFormData({
              ...formData,
              bundle_path: file.full_path,
              datastore_name: datastoreName,
            });
            setBrowseDialogOpen(false);
          }}
          filePatterns={['*.zip', '*.iso']}
        />
      </DialogContent>
    </Dialog>
  );
}
