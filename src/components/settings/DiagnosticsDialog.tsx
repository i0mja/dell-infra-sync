import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Copy, Download, Check } from "lucide-react";
import { toast } from "sonner";
import { generateDiagnosticsReport, formatDiagnosticsAsMarkdown, type DiagnosticsReport } from "@/lib/diagnostics";

interface DiagnosticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DiagnosticsDialog({ open, onOpenChange }: DiagnosticsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [markdownReport, setMarkdownReport] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const diagnosticsReport = await generateDiagnosticsReport();
      setReport(diagnosticsReport);
      const markdown = formatDiagnosticsAsMarkdown(diagnosticsReport);
      setMarkdownReport(markdown);
      toast.success("Diagnostics report generated successfully");
    } catch (error: any) {
      toast.error("Failed to generate diagnostics report", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!markdownReport) return;
    
    try {
      await navigator.clipboard.writeText(markdownReport);
      setCopied(true);
      toast.success("Diagnostics copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleDownload = () => {
    if (!report) return;

    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostics-${new Date().toISOString()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Diagnostics downloaded as JSON");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>System Diagnostics Report</DialogTitle>
          <DialogDescription>
            Generate a comprehensive diagnostic report to help troubleshoot issues
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!report ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <p className="text-muted-foreground text-center">
                Click the button below to generate a diagnostic report.<br />
                This will collect system information, database status, and recent activity.
              </p>
              <Button onClick={handleGenerate} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate Report
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button onClick={handleCopy} variant="outline" className="flex-1">
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy to Clipboard
                    </>
                  )}
                </Button>
                <Button onClick={handleDownload} variant="outline" className="flex-1">
                  <Download className="mr-2 h-4 w-4" />
                  Download JSON
                </Button>
                <Button onClick={handleGenerate} variant="outline" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Refresh
                </Button>
              </div>

              <ScrollArea className="h-[60vh] border rounded-md">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap bg-muted/50">
                  {markdownReport}
                </pre>
              </ScrollArea>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
