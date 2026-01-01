import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Grid3x3, List, Upload, Search, HardDrive } from "lucide-react";
import { useIsoImages } from "@/hooks/useIsoImages";
import { IsoImageCard } from "./IsoImageCard";
import { IsoRegisterDialog } from "./IsoRegisterDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface IsoImageLibraryProps {
  onSelectIso?: (iso: any) => void;
}

export const IsoImageLibrary = ({ onSelectIso }: IsoImageLibraryProps) => {
  const { isoImages, isLoading, deleteIso, totalStorageGB } = useIsoImages();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState("");
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Filter ISOs by search and tags
  const filteredIsos = isoImages.filter((iso) => {
    const matchesSearch = iso.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         iso.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTags = selectedTags.length === 0 || 
                       selectedTags.some(tag => iso.tags?.includes(tag));
    return matchesSearch && matchesTags;
  });

  // Get unique tags from all ISOs
  const allTags = Array.from(
    new Set(isoImages.flatMap(iso => iso.tags || []))
  );

  const handleMount = (iso: any) => {
    if (onSelectIso) {
      onSelectIso(iso);
    }
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">ISO Images Library</h3>
            <p className="text-sm text-muted-foreground">
              Manage bootable ISO images for server provisioning
            </p>
          </div>
          <Button onClick={() => setShowRegisterDialog(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Register ISO
          </Button>
        </div>
        
        {/* Storage Usage */}
        <div className="bg-muted/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Storage Used</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {totalStorageGB.toFixed(2)} GB
            </span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div 
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.min((totalStorageGB / 100) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ISOs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="icon"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tags Filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-muted-foreground">Tags:</span>
            {allTags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => {
                  setSelectedTags(prev =>
                    prev.includes(tag)
                      ? prev.filter(t => t !== tag)
                      : [...prev, tag]
                  );
                }}
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* ISO Grid/List */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading ISOs...
          </div>
        ) : filteredIsos.length === 0 ? (
          <Alert>
            <AlertDescription>
              {searchQuery || selectedTags.length > 0
                ? "No ISOs match your filters"
                : "No ISOs uploaded yet. Click 'Register ISO' to add your first image."}
            </AlertDescription>
          </Alert>
        ) : (
          <div className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
              : 'space-y-2'
          }>
            {filteredIsos.map((iso) => (
              <IsoImageCard
                key={iso.id}
                iso={iso}
                onDelete={deleteIso}
                onMount={handleMount}
              />
            ))}
          </div>
        )}
      </div>

      <IsoRegisterDialog
        open={showRegisterDialog}
        onOpenChange={setShowRegisterDialog}
      />
    </>
  );
};
