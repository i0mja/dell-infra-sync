import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ArrowLeft, 
  Download,
  FileText,
  RefreshCcw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Server,
  Loader2,
  ExternalLink
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useUpdateAvailabilityScan } from '@/hooks/useUpdateAvailabilityScan';
import { UpdateSummaryCards, EsxiSummaryCard } from './UpdateSummaryCards';
import { HostUpdateDetailsTable } from './HostUpdateDetailsTable';
import { ComponentBreakdownTable } from './ComponentBreakdownTable';
import { UpdateBlockersCard } from './UpdateBlockersCard';

interface UpdateAvailabilityReportProps {
  scanId: string;
  onBack?: () => void;
  onStartRollingUpdate?: (serverIds: string[]) => void;
}

function getScanStatusBadge(status: string) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="outline" className="bg-success/10 text-success border-success/20">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case 'running':
      return (
        <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Running
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="destructive">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge variant="secondary">
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
  }
}

function getSourceLabel(source: string) {
  switch (source) {
    case 'local_repository':
      return 'Local Repository';
    case 'dell_online_catalog':
      return 'Dell Online Catalog';
    default:
      return source;
  }
}

export function UpdateAvailabilityReport({ 
  scanId, 
  onBack,
  onStartRollingUpdate 
}: UpdateAvailabilityReportProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('hosts');
  
  const {
    scan,
    results,
    isLoading,
    isScanRunning,
    stats,
    componentSummary,
    refetch,
    cancelScan,
    isCancelling,
  } = useUpdateAvailabilityScan(scanId);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  const handleStartUpdate = (serverId: string) => {
    // Navigate to firmware update workflow for this server
    navigate(`/firmware?server=${serverId}`);
  };

  const handleStartRollingUpdate = () => {
    if (!results || results.length === 0) return;
    
    // Get all servers with updates available
    const serverIds = results
      .filter(r => r.updates_available > 0 && r.server_id)
      .map(r => r.server_id!);
    
    if (onStartRollingUpdate) {
      onStartRollingUpdate(serverIds);
    } else {
      // Navigate to rolling update workflow
      navigate(`/maintenance?action=rolling-update&servers=${serverIds.join(',')}`);
    }
  };

  if (isLoading && !scan) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!scan) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">Scan not found</p>
          <Button variant="outline" className="mt-4" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Go Back
          </Button>
        </CardContent>
      </Card>
    );
  }

  const duration = scan.started_at && scan.completed_at
    ? formatDistanceToNow(new Date(scan.started_at), { addSuffix: false })
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-3">
              Update Availability Report
              {getScanStatusBadge(scan.status)}
            </h1>
            <p className="text-muted-foreground mt-1">
              {scan.target_name || `${scan.scan_type} scan`}
              {' • '}
              {getSourceLabel(scan.firmware_source)}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isScanRunning ? (
            <Button 
              variant="outline" 
              onClick={() => cancelScan(scanId)}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Cancel Scan
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              {stats.updatesAvailable > 0 && (
                <Button onClick={handleStartRollingUpdate}>
                  <Download className="mr-2 h-4 w-4" />
                  Start Rolling Update
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scan metadata */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Started:</span>
              <span>{scan.started_at ? format(new Date(scan.started_at), 'PPp') : '-'}</span>
            </div>
            {duration && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Duration:</span>
                <span>{duration}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Hosts:</span>
              <span>{stats.hostsScanned}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <UpdateSummaryCards summary={stats} isLoading={isLoading} />

      {/* ESXi Summary */}
      {stats.hostsScanned > 0 && (
        <EsxiSummaryCard 
          esxiUpdatesAvailable={stats.esxiUpdatesAvailable || 0} 
          totalHosts={stats.hostsScanned} 
        />
      )}

      {/* Blockers Card */}
      <UpdateBlockersCard results={results || []} />

      {/* Detailed Results */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Results</CardTitle>
          <CardDescription>
            View update status by host or by component type
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-4">
              <TabsTrigger value="hosts">By Host</TabsTrigger>
              <TabsTrigger value="components">By Component</TabsTrigger>
            </TabsList>
            
            <TabsContent value="hosts">
              <HostUpdateDetailsTable 
                results={results || []}
                isLoading={isLoading}
                onStartUpdate={handleStartUpdate}
              />
            </TabsContent>
            
            <TabsContent value="components">
              <ComponentBreakdownTable 
                components={componentSummary}
                totalHosts={stats.hostsScanned}
                isLoading={isLoading}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Export Actions */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Export Report</p>
              <p className="text-sm text-muted-foreground">Download this report for documentation or approval workflows</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled>
                <FileText className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button variant="outline" size="sm" disabled>
                <FileText className="mr-2 h-4 w-4" />
                PDF
              </Button>
              <Button variant="outline" size="sm" disabled>
                <FileText className="mr-2 h-4 w-4" />
                JSON
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
