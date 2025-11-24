import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes, Search } from "lucide-react";

const inventory = [
  { asset: "R750-12", rack: "R12", slot: "U14", role: "Compute", warranty: "2026-08-15" },
  { asset: "R740xd-03", rack: "R9", slot: "U10", role: "Storage", warranty: "2025-11-01" },
  { asset: "MX7000-01", rack: "C7", slot: "Chassis", role: "Chassis", warranty: "2027-01-01" },
];

const capabilities = [
  "Auto-discovery of servers, chassis, and clusters",
  "Relationship mapping (rack → host → VM → datastore)",
  "Component-level inventory (DIMMs, drives, NICs)",
  "Warranty/contract data surfaced inline",
  "Change history per asset with diffs",
  "Search by serial/asset tag/IP/MAC",
  "Duplicate/ghost record detection",
  "Rack elevation views with slot utilization",
  "Capacity rollups by site/cluster",
  "Exportable inventory reports with filters",
];

export const InventoryTopologyPanel = () => {
  return (
    <Card className="col-span-3">
      <CardHeader className="pb-2">
        <CardTitle>Inventory, CMDB, and Topology</CardTitle>
        <CardDescription>Discovery, relationships, change history, and exports</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Rack/Slot</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Warranty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inventory.map((item) => (
              <TableRow key={item.asset}>
                <TableCell className="font-medium">{item.asset}</TableCell>
                <TableCell>
                  {item.rack} / {item.slot}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{item.role}</Badge>
                </TableCell>
                <TableCell className="text-right">{item.warranty}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Card className="border-muted-foreground/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">Topology &amp; CMDB</CardTitle>
            </div>
            <CardDescription>Auto-discovery, relationships, and exportable reports</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ScrollArea className="h-32 pr-2">
              <div className="space-y-2">
                {capabilities.map((item) => (
                  <div key={item} className="rounded border border-muted-foreground/20 p-2">
                    {item}
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="flex items-center gap-1">
                <Search className="h-3 w-3" /> Search by serial/asset/IP
              </Badge>
              <Badge variant="outline">Export inventory</Badge>
              <Badge variant="outline">Rack elevations</Badge>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
};

