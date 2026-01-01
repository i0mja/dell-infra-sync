import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ServerGroupsManagement } from "@/components/settings/ServerGroupsManagement";
import { Briefcase } from "lucide-react";

export function ServerGroupsCard() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500/10">
            <Briefcase className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <CardTitle className="text-base">Server Groups</CardTitle>
            <CardDescription className="text-xs">
              Organize servers into logical groups for batch operations
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ServerGroupsManagement />
      </CardContent>
    </Card>
  );
}
