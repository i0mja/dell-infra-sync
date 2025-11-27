import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileCode } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface GenericResultsProps {
  details: any;
}

export const GenericResults = ({ details }: GenericResultsProps) => {
  if (!details || Object.keys(details).length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-muted-foreground">
          No additional details available for this job.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <FileCode className="h-4 w-4" />
          Job Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-muted p-3 rounded">
            {JSON.stringify(details, null, 2)}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
