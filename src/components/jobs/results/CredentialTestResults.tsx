import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, XCircle, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CredentialTestResultsProps {
  details: any;
}

export const CredentialTestResults = ({ details }: CredentialTestResultsProps) => {
  const successCount = details?.success_count || 0;
  const failedCount = details?.failed_count || 0;
  const total = successCount + failedCount;
  const successRate = total > 0 ? Math.round((successCount / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Successful
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{successCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Credentials valid</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{failedCount}</div>
            <p className="text-xs text-muted-foreground mt-1">Auth rejected</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" />
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">Of {total} tested</p>
          </CardContent>
        </Card>
      </div>

      {details?.results && details.results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Test Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {details.results.map((result: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-2 border rounded">
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-mono">{result.ip_address || result.server}</span>
                </div>
                {result.success ? (
                  <Badge variant="secondary">Connected</Badge>
                ) : (
                  <Badge variant="destructive">{result.error || "Failed"}</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
