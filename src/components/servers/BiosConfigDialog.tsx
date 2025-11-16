import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Save, Loader2, Search, RotateCcw, Eye, Star, Trash2, MoreVertical, Plus, Download } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface BiosConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname: string | null;
    service_tag: string | null;
  };
}

interface BiosConfig {
  id: string;
  server_id: string;
  attributes: Record<string, any>;
  pending_attributes: Record<string, any> | null;
  bios_version: string | null;
  snapshot_type: string;
  notes: string | null;
  captured_at: string;
  created_by: string | null;
}

export function BiosConfigDialog({ open, onOpenChange, server }: BiosConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'view' | 'edit' | 'compare' | 'history'>('view');
  const [configurations, setConfigurations] = useState<BiosConfig[]>([]);
  const [currentConfig, setCurrentConfig] = useState<BiosConfig | null>(null);
  const [editedAttributes, setEditedAttributes] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [baselineConfigId, setBaselineConfigId] = useState<string>("");
  const [compareConfigId, setCompareConfigId] = useState<string>("");
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchConfigurations();
    }
  }, [open, server.id]);

  const fetchConfigurations = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('bios_configurations')
        .select('*')
        .eq('server_id', server.id)
        .order('captured_at', { ascending: false });

      if (error) throw error;

      setConfigurations(data as BiosConfig[] || []);
      if (data && data.length > 0) {
        setCurrentConfig(data[0] as BiosConfig);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCaptureSnapshot = async (notes?: string) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'bios_config_read',
          created_by: user.id,
          status: 'pending',
          target_scope: { server_ids: [server.id] },
          details: {
            server_id: server.id,
            snapshot_type: 'current',
            notes: notes || 'Manual snapshot'
          }
        });

      if (jobError) throw jobError;

      toast({
        title: "Snapshot Job Created",
        description: "BIOS configuration will be captured shortly",
      });

      setTimeout(() => fetchConfigurations(), 3000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAttributeChange = (name: string, value: any) => {
    setEditedAttributes(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleResetChanges = () => {
    setEditedAttributes({});
  };

  const handleApplyChanges = async (rebootType: 'none' | 'graceful' | 'forced') => {
    if (Object.keys(editedAttributes).length === 0) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'bios_config_write',
          created_by: user.id,
          status: 'pending',
          target_scope: { server_ids: [server.id] },
          details: {
            server_id: server.id,
            attributes: editedAttributes,
            reboot_type: rebootType,
            create_snapshot: true,
            snapshot_notes: `Applied ${Object.keys(editedAttributes).length} BIOS changes`
          }
        });

      if (jobError) throw jobError;

      toast({
        title: "BIOS Changes Queued",
        description: `Job created to apply ${Object.keys(editedAttributes).length} changes${
          rebootType !== 'none' ? ' with ' + rebootType + ' reboot' : ''
        }`,
      });

      setEditedAttributes({});
      setTimeout(() => fetchConfigurations(), 2000);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreConfig = async (config: BiosConfig) => {
    if (!confirm(`Restore BIOS configuration from ${formatDistanceToNow(new Date(config.captured_at), { addSuffix: true })}? This will apply ${Object.keys(config.attributes).length} settings. A reboot will be required.`)) {
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'bios_config_write',
          created_by: user.id,
          status: 'pending',
          target_scope: { server_ids: [server.id] },
          details: {
            server_id: server.id,
            attributes: config.attributes,
            reboot_type: 'none',
            create_snapshot: true,
            snapshot_notes: `Restored from ${new Date(config.captured_at).toLocaleString()}`
          }
        });

      if (jobError) throw jobError;

      toast({
        title: "Restore Job Created",
        description: "Configuration will be applied. Reboot required to take effect.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!confirm("Delete this BIOS configuration snapshot?")) return;

    try {
      const { error } = await supabase
        .from('bios_configurations')
        .delete()
        .eq('id', configId);

      if (error) throw error;

      toast({
        title: "Configuration Deleted",
        description: "Snapshot removed successfully",
      });

      fetchConfigurations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleSetAsBaseline = async (config: BiosConfig) => {
    try {
      const { error } = await supabase
        .from('bios_configurations')
        .update({ snapshot_type: 'baseline' })
        .eq('id', config.id);

      if (error) throw error;

      toast({
        title: "Baseline Set",
        description: "Configuration marked as baseline",
      });

      fetchConfigurations();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const categorizeAttribute = (name: string): string => {
    const nameLower = name.toLowerCase();
    if (nameLower.includes('proc') || nameLower.includes('cpu')) return 'Processor';
    if (nameLower.includes('mem') || nameLower.includes('memory')) return 'Memory';
    if (nameLower.includes('boot') || nameLower.includes('uefi')) return 'Boot Settings';
    if (nameLower.includes('raid') || nameLower.includes('sata') || nameLower.includes('storage')) return 'Storage';
    if (nameLower.includes('nic') || nameLower.includes('network')) return 'Network';
    if (nameLower.includes('security') || nameLower.includes('tpm')) return 'Security';
    return 'System';
  };

  const getAttributesByCategory = () => {
    if (!currentConfig) return {};
    
    const attributes = currentConfig.attributes;
    const categories: Record<string, Array<{ name: string; value: any }>> = {};
    
    Object.entries(attributes).forEach(([name, value]) => {
      const category = categorizeAttribute(name);
      if (!categories[category]) categories[category] = [];
      categories[category].push({ name, value });
    });
    
    return categories;
  };

  const filterAttributes = (attrs: Array<{ name: string; value: any }>) => {
    if (!searchQuery) return attrs;
    return attrs.filter(attr => 
      attr.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const getComparisonResults = () => {
    const baseline = configurations.find(c => c.id === baselineConfigId);
    const compare = configurations.find(c => c.id === compareConfigId);
    
    if (!baseline || !compare) return [];
    
    const allKeys = new Set([
      ...Object.keys(baseline.attributes),
      ...Object.keys(compare.attributes)
    ]);
    
    const results = Array.from(allKeys).map(key => ({
      name: key,
      baselineValue: baseline.attributes[key],
      compareValue: compare.attributes[key],
      changed: baseline.attributes[key] !== compare.attributes[key]
    }));
    
    return showOnlyDifferences ? results.filter(r => r.changed) : results;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>BIOS Configuration - {server.hostname || server.ip_address}</DialogTitle>
          <DialogDescription>
            {server.service_tag && `Service Tag: ${server.service_tag}`}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="view">View</TabsTrigger>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="view" className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search settings..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              <Button onClick={() => handleCaptureSnapshot()} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="ml-2">Capture Snapshot</span>
              </Button>
            </div>

            {currentConfig?.pending_attributes && Object.keys(currentConfig.pending_attributes).length > 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {Object.keys(currentConfig.pending_attributes).length} settings pending reboot to apply
                </AlertDescription>
              </Alert>
            )}

            {currentConfig && (
              <ScrollArea className="h-[500px]">
                <Accordion type="single" collapsible className="w-full">
                  {Object.entries(getAttributesByCategory()).map(([category, attrs]) => {
                    const filteredAttrs = filterAttributes(attrs);
                    if (filteredAttrs.length === 0) return null;
                    
                    return (
                      <AccordionItem key={category} value={category}>
                        <AccordionTrigger>
                          {category} ({filteredAttrs.length})
                        </AccordionTrigger>
                        <AccordionContent>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Attribute</TableHead>
                                <TableHead>Current Value</TableHead>
                                <TableHead>Pending Value</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredAttrs.map(attr => (
                                <TableRow key={attr.name}>
                                  <TableCell className="font-mono text-sm">{attr.name}</TableCell>
                                  <TableCell>{String(attr.value)}</TableCell>
                                  <TableCell>
                                    {currentConfig.pending_attributes?.[attr.name] ? (
                                      <Badge variant="secondary">
                                        {String(currentConfig.pending_attributes[attr.name])}
                                      </Badge>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </ScrollArea>
            )}

            {!currentConfig && !loading && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No BIOS configuration captured yet. Click "Capture Snapshot" to read the current configuration.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="edit" className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Most BIOS changes require a system reboot to take effect. Changes are staged and applied after reboot.
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search settings..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
              {Object.keys(editedAttributes).length > 0 && (
                <Badge variant="secondary" className="py-2">
                  {Object.keys(editedAttributes).length} changes
                </Badge>
              )}
            </div>

            {currentConfig && (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {Object.entries(currentConfig.attributes)
                    .filter(([name]) => name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(([name, value]) => (
                      <Card key={name}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <Label className="font-mono text-sm">{name}</Label>
                              {editedAttributes[name] !== undefined && (
                                <div className="mt-1">
                                  <Badge variant="outline" className="text-xs">
                                    Changed: {String(value)} → {String(editedAttributes[name])}
                                  </Badge>
                                </div>
                              )}
                            </div>
                            <div className="w-48">
                              {typeof value === 'boolean' ? (
                                <Switch
                                  checked={editedAttributes[name] ?? value}
                                  onCheckedChange={(checked) => handleAttributeChange(name, checked)}
                                />
                              ) : (
                                <Input
                                  value={editedAttributes[name] ?? value}
                                  onChange={(e) => handleAttributeChange(name, e.target.value)}
                                  className="text-sm"
                                />
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </ScrollArea>
            )}

            <div className="flex justify-between pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleResetChanges}
                disabled={Object.keys(editedAttributes).length === 0}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset Changes
              </Button>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleApplyChanges('none')}
                  disabled={Object.keys(editedAttributes).length === 0 || loading}
                >
                  Apply (No Reboot)
                </Button>
                <Button
                  onClick={() => handleApplyChanges('graceful')}
                  disabled={Object.keys(editedAttributes).length === 0 || loading}
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Apply & Reboot
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compare" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Baseline Configuration</Label>
                <Select value={baselineConfigId} onValueChange={setBaselineConfigId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select baseline..." />
                  </SelectTrigger>
                  <SelectContent>
                    {configurations.map(config => (
                      <SelectItem key={config.id} value={config.id}>
                        {formatDistanceToNow(new Date(config.captured_at), { addSuffix: true })} - {config.notes || 'Snapshot'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Compare To</Label>
                <Select value={compareConfigId} onValueChange={setCompareConfigId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select configuration..." />
                  </SelectTrigger>
                  <SelectContent>
                    {configurations.map(config => (
                      <SelectItem key={config.id} value={config.id}>
                        {formatDistanceToNow(new Date(config.captured_at), { addSuffix: true })} - {config.notes || 'Snapshot'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={showOnlyDifferences}
                onCheckedChange={setShowOnlyDifferences}
              />
              <Label>Show only differences</Label>
            </div>

            {baselineConfigId && compareConfigId && (
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Attribute</TableHead>
                      <TableHead>Baseline</TableHead>
                      <TableHead>Compare</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getComparisonResults().map(result => (
                      <TableRow
                        key={result.name}
                        className={result.changed ? 'bg-yellow-50 dark:bg-yellow-950/20' : ''}
                      >
                        <TableCell className="font-mono text-sm">{result.name}</TableCell>
                        <TableCell>{String(result.baselineValue)}</TableCell>
                        <TableCell>{String(result.compareValue)}</TableCell>
                        <TableCell>
                          {result.changed ? (
                            <Badge variant="secondary">Changed</Badge>
                          ) : (
                            <Badge variant="outline">Same</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {configurations.length} saved configurations
              </div>
              <Button onClick={() => handleCaptureSnapshot()} size="sm" disabled={loading}>
                <Plus className="h-4 w-4 mr-2" />
                New Snapshot
              </Button>
            </div>

            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {configurations.map(config => (
                  <Card key={config.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge variant={config.snapshot_type === 'baseline' ? 'default' : 'secondary'}>
                              {config.snapshot_type}
                            </Badge>
                            <span className="text-sm font-medium">
                              {config.notes || 'Unnamed snapshot'}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <div>Captured: {formatDistanceToNow(new Date(config.captured_at), { addSuffix: true })}</div>
                            <div>BIOS Version: {config.bios_version}</div>
                            <div>{Object.keys(config.attributes).length} attributes</div>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleRestoreConfig(config)}>
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Restore This Config
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleSetAsBaseline(config)}>
                              <Star className="h-4 w-4 mr-2" />
                              Set as Baseline
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDeleteConfig(config.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
