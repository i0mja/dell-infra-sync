import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Server } from "lucide-react";
import { useEsxiProfiles, EsxiUpgradeProfile } from "@/hooks/useEsxiProfiles";
import { EsxiProfileCard } from "./EsxiProfileCard";
import { EsxiProfileDialog } from "./EsxiProfileDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function EsxiProfilesTab() {
  const { profiles, isLoading, deleteProfile } = useEsxiProfiles();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<EsxiUpgradeProfile | null>(null);

  const filteredProfiles = profiles.filter((profile) => {
    const matchesSearch = 
      profile.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      profile.target_version.toLowerCase().includes(searchQuery.toLowerCase()) ||
      profile.profile_name.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = 
      statusFilter === "all" ||
      (statusFilter === "active" && profile.is_active) ||
      (statusFilter === "inactive" && !profile.is_active);

    return matchesSearch && matchesStatus;
  });

  const handleEdit = (profile: EsxiUpgradeProfile) => {
    setEditingProfile(profile);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditingProfile(null);
    setDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingProfile(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading ESXi profiles...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">ESXi Upgrade Profiles</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Manage ESXi upgrade bundles and profiles for host updates
          </p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Profile
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search profiles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Profiles</SelectItem>
            <SelectItem value="active">Active Only</SelectItem>
            <SelectItem value="inactive">Inactive Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filteredProfiles.length === 0 ? (
        <div className="text-center py-12">
          <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No ESXi profiles found</h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery || statusFilter !== "all"
              ? "Try adjusting your filters"
              : "Create your first ESXi upgrade profile to get started"}
          </p>
          {!searchQuery && statusFilter === "all" && (
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Create Profile
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground">
            Showing {filteredProfiles.length} of {profiles.length} profiles
          </div>
          <div className="grid gap-4">
            {filteredProfiles.map((profile) => (
              <EsxiProfileCard
                key={profile.id}
                profile={profile}
                onDelete={deleteProfile.mutate}
                onEdit={handleEdit}
              />
            ))}
          </div>
        </>
      )}

      <EsxiProfileDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        editProfile={editingProfile}
      />
    </div>
  );
}
