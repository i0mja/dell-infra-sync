import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "lucide-react";

const VCenter = () => {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">vCenter Integration</h1>
        <p className="text-muted-foreground">
          Manage VMware vCenter ESXi hosts and cluster integration
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle>vCenter Hosts</CardTitle>
          </div>
          <CardDescription>Coming in Phase 2</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This section will display ESXi hosts from vCenter, allow linking to physical servers,
            and show cluster topology. Features include:
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>• Sync ESXi hosts from vCenter API</li>
            <li>• Auto-link physical servers via Service Tag matching</li>
            <li>• View cluster membership and health status</li>
            <li>• Monitor maintenance mode states</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default VCenter;
