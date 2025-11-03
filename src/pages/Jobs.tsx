import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase } from "lucide-react";

const Jobs = () => {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Job Management</h1>
        <p className="text-muted-foreground">
          Monitor and create firmware update and discovery jobs
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            <CardTitle>Jobs</CardTitle>
          </div>
          <CardDescription>Coming in Phase 3</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            This section will manage job orchestration for firmware updates and server discovery.
            Features include:
          </p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>• Create firmware update jobs with rolling updates</li>
            <li>• Schedule IP range discovery scans</li>
            <li>• Monitor job progress in real-time</li>
            <li>• View job history and audit logs</li>
            <li>• Integrate with vCenter maintenance mode</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default Jobs;
