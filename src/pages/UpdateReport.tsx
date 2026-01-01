import { useParams, useNavigate } from "react-router-dom";
import { UpdateAvailabilityReport } from "@/components/updates/UpdateAvailabilityReport";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function UpdateReport() {
  const { scanId } = useParams<{ scanId: string }>();
  const navigate = useNavigate();

  if (!scanId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No scan ID provided</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-6 space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink 
                onClick={() => navigate('/reports')}
                className="cursor-pointer"
              >
                Reports
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink 
                onClick={() => navigate('/reports?category=updates')}
                className="cursor-pointer"
              >
                Update Reports
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Scan Details</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <UpdateAvailabilityReport
          scanId={scanId}
          onBack={() => navigate(-1)}
          onStartRollingUpdate={(serverIds) => {
            // Navigate to maintenance planner with context
            navigate('/maintenance-planner', { 
              state: { preSelectedServers: serverIds } 
            });
          }}
        />
      </div>
    </div>
  );
}
