import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Network, ChevronDown, Settings2 } from "lucide-react";

export function NetworkAdvancedSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [hasCustomValues, setHasCustomValues] = useState(false);
  
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [connectionTimeout, setConnectionTimeout] = useState(30);
  const [readTimeout, setReadTimeout] = useState(60);
  const [operationTimeout, setOperationTimeout] = useState(300);
  const [maxRetryAttempts, setMaxRetryAttempts] = useState(3);
  const [retryBackoffType, setRetryBackoffType] = useState<'exponential' | 'linear' | 'fixed'>('exponential');
  const [retryDelay, setRetryDelay] = useState(2);

  // Default values for comparison
  const defaults = {
    connectionTimeout: 30,
    readTimeout: 60,
    operationTimeout: 300,
    maxRetryAttempts: 3,
    retryBackoffType: 'exponential',
    retryDelay: 2,
  };

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    // Check if any values differ from defaults
    const hasCustom = 
      connectionTimeout !== defaults.connectionTimeout ||
      readTimeout !== defaults.readTimeout ||
      operationTimeout !== defaults.operationTimeout ||
      maxRetryAttempts !== defaults.maxRetryAttempts ||
      retryBackoffType !== defaults.retryBackoffType ||
      retryDelay !== defaults.retryDelay;
    
    setHasCustomValues(hasCustom);
  }, [connectionTimeout, readTimeout, operationTimeout, maxRetryAttempts, retryBackoffType, retryDelay]);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('network_settings')
      .select('*')
      .maybeSingle();

    if (data) {
      setSettingsId(data.id);
      setConnectionTimeout(data.connection_timeout_seconds);
      setReadTimeout(data.read_timeout_seconds);
      setOperationTimeout(data.operation_timeout_seconds);
      setMaxRetryAttempts(data.max_retry_attempts);
      setRetryBackoffType(data.retry_backoff_type as 'exponential' | 'linear' | 'fixed');
      setRetryDelay(data.retry_delay_seconds);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const settings = {
        connection_timeout_seconds: connectionTimeout,
        read_timeout_seconds: readTimeout,
        operation_timeout_seconds: operationTimeout,
        max_retry_attempts: maxRetryAttempts,
        retry_backoff_type: retryBackoffType,
        retry_delay_seconds: retryDelay,
      };

      if (settingsId) {
        await supabase
          .from('network_settings')
          .update(settings)
          .eq('id', settingsId);
      } else {
        const { data } = await supabase
          .from('network_settings')
          .insert([settings])
          .select()
          .single();
        if (data) setSettingsId(data.id);
      }

      toast({ title: "Saved", description: "Network settings updated" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setConnectionTimeout(defaults.connectionTimeout);
    setReadTimeout(defaults.readTimeout);
    setOperationTimeout(defaults.operationTimeout);
    setMaxRetryAttempts(defaults.maxRetryAttempts);
    setRetryBackoffType(defaults.retryBackoffType as 'exponential' | 'linear' | 'fixed');
    setRetryDelay(defaults.retryDelay);
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                <div>
                  <CardTitle className="text-base">Advanced Network Settings</CardTitle>
                  <CardDescription className="text-xs">
                    Timeouts and retry configuration
                    {hasCustomValues && (
                      <span className="ml-2 text-amber-600 dark:text-amber-400">• Custom values set</span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-xs">Connection Timeout (s)</Label>
                <Input
                  type="number"
                  value={connectionTimeout}
                  onChange={(e) => setConnectionTimeout(parseInt(e.target.value) || 30)}
                  min={5}
                  max={120}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Read Timeout (s)</Label>
                <Input
                  type="number"
                  value={readTimeout}
                  onChange={(e) => setReadTimeout(parseInt(e.target.value) || 60)}
                  min={10}
                  max={300}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Operation Timeout (s)</Label>
                <Input
                  type="number"
                  value={operationTimeout}
                  onChange={(e) => setOperationTimeout(parseInt(e.target.value) || 300)}
                  min={60}
                  max={600}
                  className="h-8"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-xs">Max Retry Attempts</Label>
                <Input
                  type="number"
                  value={maxRetryAttempts}
                  onChange={(e) => setMaxRetryAttempts(parseInt(e.target.value) || 3)}
                  min={0}
                  max={10}
                  className="h-8"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Retry Backoff</Label>
                <Select value={retryBackoffType} onValueChange={(v) => setRetryBackoffType(v as any)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exponential">Exponential</SelectItem>
                    <SelectItem value="linear">Linear</SelectItem>
                    <SelectItem value="fixed">Fixed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Retry Delay (s)</Label>
                <Input
                  type="number"
                  value={retryDelay}
                  onChange={(e) => setRetryDelay(parseInt(e.target.value) || 2)}
                  min={1}
                  max={30}
                  className="h-8"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={loading} size="sm">
                {loading ? "Saving..." : "Save Settings"}
              </Button>
              {hasCustomValues && (
                <Button variant="outline" onClick={handleReset} size="sm">
                  Reset to Defaults
                </Button>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
