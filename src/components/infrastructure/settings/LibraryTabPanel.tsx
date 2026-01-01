import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { IsoImageLibrary } from "@/components/settings/IsoImageLibrary";
import { FirmwareLibrary } from "@/components/settings/FirmwareLibrary";
import { ZfsApplianceLibrary } from "@/components/settings/ZfsApplianceLibrary";
import { Disc, Database, HardDrive } from "lucide-react";

interface LibraryTabPanelProps {
  defaultTab?: string;
}

export function LibraryTabPanel({ defaultTab = "iso" }: LibraryTabPanelProps) {
  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="iso" className="gap-2">
          <Disc className="h-4 w-4" />
          ISO Images
        </TabsTrigger>
        <TabsTrigger value="firmware" className="gap-2">
          <Database className="h-4 w-4" />
          Firmware
        </TabsTrigger>
        <TabsTrigger value="zfs" className="gap-2">
          <HardDrive className="h-4 w-4" />
          ZFS Appliances
        </TabsTrigger>
      </TabsList>

      <TabsContent value="iso" className="mt-4">
        <Card>
          <CardContent className="p-6">
            <IsoImageLibrary />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="firmware" className="mt-4">
        <Card>
          <CardContent className="p-6">
            <FirmwareLibrary />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="zfs" className="mt-4">
        <Card>
          <CardContent className="p-6">
            <ZfsApplianceLibrary />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
