import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Search, HardDrive } from "lucide-react";
import { useFirmwarePackages } from "@/hooks/useFirmwarePackages";
import { FirmwarePackageCard } from "./FirmwarePackageCard";
import { FirmwareUploadDialog } from "./FirmwareUploadDialog";
import { Progress } from "@/components/ui/progress";

export function FirmwareLibrary() {
  const { firmwarePackages, isLoading, deleteFirmware, totalStorageGB } = useFirmwarePackages();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterComponent, setFilterComponent] = useState<string>("all");

  const maxStorageGB = 200; // From config
  const storagePercentage = (totalStorageGB / maxStorageGB) * 100;

  const filteredPackages = firmwarePackages.filter((pkg) => {
    const matchesSearch = 
      pkg.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pkg.dell_version.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pkg.description?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesComponent = filterComponent === "all" || pkg.component_type === filterComponent;
    
    return matchesSearch && matchesComponent;
  });

  const componentTypes = ["all", ...new Set(firmwarePackages.map(pkg => pkg.component_type))];

  return (
    <>
      <div className="space-y-6">
        {/* Header Row */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Firmware Library</h3>
            <p className="text-sm text-muted-foreground">
              Manage Dell firmware packages for server updates
            </p>
          </div>
          <Button onClick={() => setUploadDialogOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload Firmware
          </Button>
        </div>

        {/* Storage indicator */}
        <div className="bg-muted/30 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              <span className="font-medium text-foreground">Storage Usage</span>
            </div>
            <span className="font-medium">
              {totalStorageGB.toFixed(2)} GB / {maxStorageGB} GB
            </span>
          </div>
          <Progress value={storagePercentage} className="h-2" />
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search firmware packages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterComponent} onValueChange={setFilterComponent}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Components" />
            </SelectTrigger>
            <SelectContent>
              {componentTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type === "all" ? "All Components" : type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Firmware packages grid */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">
            Loading firmware packages...
          </div>
        ) : filteredPackages.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <HardDrive className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <div>
              <p className="font-medium">No firmware packages found</p>
              <p className="text-sm text-muted-foreground">
                {searchQuery || filterComponent !== "all"
                  ? "Try adjusting your filters"
                  : "Upload your first firmware package to get started"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredPackages.map((firmware) => (
              <FirmwarePackageCard
                key={firmware.id}
                firmware={firmware}
                onDelete={(id) => deleteFirmware.mutate(id)}
              />
            ))}
          </div>
        )}

        {/* Package count */}
        {!isLoading && filteredPackages.length > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            Showing {filteredPackages.length} of {firmwarePackages.length} firmware packages
          </div>
        )}
      </div>

      <FirmwareUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />
    </>
  );
}
