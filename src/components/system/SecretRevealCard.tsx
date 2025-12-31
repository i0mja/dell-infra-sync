import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Eye, Key, Loader2, RefreshCw, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SecretRevealCardProps {
  title: string;
  description: string;
  envVarName: string;
  secret: string | null;
  isRevealed: boolean;
  isLoading: boolean;
  isConfigured?: boolean | null;
  showStatus?: boolean;
  statusMessage?: {
    configured: string;
    notConfigured: string;
  };
  onReveal: () => void;
  onGenerate?: () => void;
  canRegenerate?: boolean;
  linuxInstructions?: {
    filePath: string;
    restartCommand: string;
  };
  windowsInstructions?: {
    command: string;
    restartCommand: string;
  };
}

export function SecretRevealCard({
  title,
  description,
  envVarName,
  secret,
  isRevealed,
  isLoading,
  isConfigured,
  showStatus = false,
  statusMessage,
  onReveal,
  onGenerate,
  canRegenerate = false,
  linuxInstructions,
  windowsInstructions,
}: SecretRevealCardProps) {
  const { toast } = useToast();

  const handleCopy = () => {
    if (secret) {
      navigator.clipboard.writeText(`${envVarName}=${secret}`);
      toast({ 
        title: "Copied to clipboard", 
        description: "Ready to paste into your .env file" 
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Key className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status indicator */}
        {showStatus && statusMessage && (
          <>
            {isConfigured === null ? (
              <Alert className="border-muted py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription className="text-sm">Checking status...</AlertDescription>
              </Alert>
            ) : isConfigured ? (
              <Alert className="border-green-500/50 bg-green-500/10 py-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-sm text-green-700 dark:text-green-400">
                  {statusMessage.configured}
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive" className="py-2">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {statusMessage.notConfigured}
                </AlertDescription>
              </Alert>
            )}
          </>
        )}

        {/* Secret display */}
        {isRevealed && secret ? (
          <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
            <div className="flex gap-2 items-center">
              <code className="flex-1 px-2 py-1.5 bg-background border rounded text-xs font-mono truncate">
                {envVarName}={secret}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                title="Copy as environment variable"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            
            {(linuxInstructions || windowsInstructions) && (
              <Tabs defaultValue="linux" className="mt-2">
                <TabsList className="h-7">
                  <TabsTrigger value="linux" className="text-xs px-2 py-0.5">Linux</TabsTrigger>
                  <TabsTrigger value="windows" className="text-xs px-2 py-0.5">Windows</TabsTrigger>
                </TabsList>
                
                {linuxInstructions && (
                  <TabsContent value="linux" className="mt-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Add to <code className="px-1 bg-muted rounded">{linuxInstructions.filePath}</code>:
                    </p>
                    <code className="block px-2 py-1 bg-background border rounded text-xs font-mono break-all">
                      {envVarName}={secret}
                    </code>
                    <p className="text-xs text-muted-foreground">Then restart:</p>
                    <code className="block px-2 py-1 bg-background border rounded text-xs font-mono">
                      {linuxInstructions.restartCommand}
                    </code>
                  </TabsContent>
                )}
                
                {windowsInstructions && (
                  <TabsContent value="windows" className="mt-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground">Add to NSSM environment:</p>
                    <code className="block px-2 py-1 bg-background border rounded text-xs font-mono whitespace-pre-wrap break-all">
                      {windowsInstructions.command.replace('${SECRET}', secret)}
                    </code>
                    <p className="text-xs text-muted-foreground">Then restart:</p>
                    <code className="block px-2 py-1 bg-background border rounded text-xs font-mono">
                      {windowsInstructions.restartCommand}
                    </code>
                  </TabsContent>
                )}
              </Tabs>
            )}

            {/* Show regenerate button when already revealed and canRegenerate is true */}
            {onGenerate && canRegenerate && (
              <Button
                onClick={onGenerate}
                disabled={isLoading}
                variant="outline"
                size="sm"
                className="mt-2"
              >
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                Regenerate
              </Button>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            {/* Show Reveal button when secret exists but isn't revealed yet */}
            {isConfigured && canRegenerate && (
              <Button
                onClick={onReveal}
                disabled={isLoading}
                variant="outline"
                size="sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Retrieving...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    Reveal
                  </>
                )}
              </Button>
            )}
            
            {/* Show Generate button when no secret exists, or for non-regeneratable secrets */}
            {onGenerate && canRegenerate && !isConfigured && (
              <Button
                onClick={onGenerate}
                disabled={isLoading}
                size="sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Key className="mr-2 h-3.5 w-3.5" />
                    Generate
                  </>
                )}
              </Button>
            )}

            {/* For secrets that can only be revealed (like SERVICE_ROLE_KEY) */}
            {!canRegenerate && (
              <Button
                onClick={onReveal}
                disabled={isLoading}
                variant="outline"
                size="sm"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Retrieving...
                  </>
                ) : (
                  <>
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    Reveal
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
