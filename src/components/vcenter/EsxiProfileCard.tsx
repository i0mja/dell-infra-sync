import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Server, Calendar, HardDrive, AlertCircle } from "lucide-react";
import { EsxiUpgradeProfile } from "@/hooks/useEsxiProfiles";
import { format } from "date-fns";

interface EsxiProfileCardProps {
  profile: EsxiUpgradeProfile;
  onDelete: (id: string) => void;
  onEdit: (profile: EsxiUpgradeProfile) => void;
}

export function EsxiProfileCard({ profile, onDelete, onEdit }: EsxiProfileCardProps) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Server className="h-5 w-5 text-primary" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-sm truncate">{profile.name}</h3>
              <Badge variant={profile.is_active ? "default" : "secondary"} className="text-xs">
                {profile.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
            
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">ESXi {profile.target_version}</span>
              </div>
              
              <div className="text-xs text-muted-foreground">
                <div className="flex items-center gap-1 mb-1">
                  <HardDrive className="h-3 w-3" />
                  <span className="truncate">{profile.bundle_path}</span>
                </div>
                <div className="ml-4">Profile: {profile.profile_name}</div>
              </div>
              
              {profile.datastore_name && (
                <div className="text-xs text-muted-foreground">
                  Datastore: {profile.datastore_name}
                </div>
              )}
              
              {profile.min_source_version && (
                <div className="text-xs text-muted-foreground">
                  Min version: {profile.min_source_version}
                </div>
              )}
              
              {profile.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                  {profile.description}
                </p>
              )}
              
              <div className="flex items-center gap-3 mt-2">
                {profile.release_date && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    <span>Released {format(new Date(profile.release_date), "MMM d, yyyy")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(profile)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(profile.id)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
