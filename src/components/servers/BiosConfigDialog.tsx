import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { logActivityDirect } from "@/hooks/useActivityLog";
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
import { getBiosConfig, checkApiHealth } from "@/lib/job-executor-api";

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
  const [capturingSnapshot, setCapturingSnapshot] = useState(false);
  const [activeTab, setActiveTab] = useState<'view' | 'edit' | 'compare' | 'history'>('view');
  const [configurations, setConfigurations] = useState<BiosConfig[]>([]);
  const [currentConfig, setCurrentConfig] = useState<BiosConfig | null>(null);
  const [editedAttributes, setEditedAttributes] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [baselineConfigId, setBaselineConfigId] = useState<string>("");
  const [compareConfigId, setCompareConfigId] = useState<string>("");
  const [showOnlyDifferences, setShowOnlyDifferences] = useState(false);
  const [activeWizardCategory, setActiveWizardCategory] = useState<string>("");
  const [customAttributeInputs, setCustomAttributeInputs] = useState<Record<string, string>>({});
  const autoTabSelectedRef = useRef(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchConfigurations();
    }
  }, [open, server.id]);

  useEffect(() => {
    if (!open) {
      autoTabSelectedRef.current = false;
      setActiveTab('view');
    }
  }, [open]);

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
    setCapturingSnapshot(true);
    try {
      // Try instant API first
      const apiAvailable = await checkApiHealth();
      if (apiAvailable) {
        const result = await getBiosConfig(server.id, notes || 'Manual snapshot');
        if (result.success) {
          toast({
            title: "Snapshot Complete",
            description: "BIOS configuration captured successfully",
          });
          
          logActivityDirect('bios_fetch', 'server', server.hostname || server.ip_address, { notes: notes || 'Manual snapshot' }, { targetId: server.id, success: true });
          
          // Refresh configurations list
          await fetchConfigurations();
          setCapturingSnapshot(false);
          return;
        }
      }
      
      // Fall back to job queue
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: job, error: jobError } = await supabase
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
        })
        .select()
        .single();

      if (jobError) throw jobError;

      toast({
        title: "Capturing BIOS Configuration",
        description: "Reading settings from server...",
      });

      logActivityDirect('bios_fetch', 'server', server.hostname || server.ip_address, { notes: notes || 'Manual snapshot' }, { targetId: server.id, success: true });

      // Poll for job completion
      const pollInterval = setInterval(async () => {
        const { data: updatedJob } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', job.id)
          .single();

        if (updatedJob?.status === 'completed') {
          clearInterval(pollInterval);
          setCapturingSnapshot(false);
          await fetchConfigurations();
          toast({
            title: "Snapshot Complete",
            description: "BIOS configuration captured successfully",
          });
        } else if (updatedJob?.status === 'failed') {
          clearInterval(pollInterval);
          setCapturingSnapshot(false);
          toast({
            title: "Snapshot Failed",
            description: (updatedJob.details as any)?.error || "Failed to capture BIOS configuration",
            variant: "destructive",
          });
        }
      }, 2000);

      // Timeout after 60 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        setCapturingSnapshot(false);
      }, 60000);

    } catch (error: any) {
      setCapturingSnapshot(false);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });

      logActivityDirect('bios_fetch', 'server', server.hostname || server.ip_address, {}, { targetId: server.id, success: false, error: error.message });
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

  const getWizardCategories = () => {
    if (!currentConfig) return [];

    const categories = Object.entries(currentConfig.attributes).reduce<Record<string, Array<{ name: string; value: any }>>>((acc, [name, value]) => {
      const category = categorizeAttribute(name);
      if (!acc[category]) acc[category] = [];
      acc[category].push({ name, value });
      return acc;
    }, {});

    return Object.entries(categories)
      .map(([name, attributes]) => ({
        name,
        attributes: filterAttributes(attributes)
      }))
      .filter(category => category.attributes.length > 0);
  };

  const wizardCategories = useMemo(() => getWizardCategories(), [currentConfig, searchQuery]);

  useEffect(() => {
    if (wizardCategories.length > 0 && !wizardCategories.find(c => c.name === activeWizardCategory)) {
      setActiveWizardCategory(wizardCategories[0].name);
    }
  }, [activeWizardCategory, wizardCategories]);

  const commonOptionSets = [
    ["Enabled", "Disabled"],
    ["Enabled", "Disabled", "Auto"],
    ["On", "Off", "Auto"],
    ["UEFI", "Legacy"],
    ["BIOS", "UEFI", "Auto"],
  ];

  const keywordOptionSets: Array<{ keywords: string[]; options: string[] }> = [
    { keywords: ["boot"], options: ["UEFI", "Legacy", "Auto"] },
    { keywords: ["nic", "network", "pxe"], options: ["Enabled", "Disabled", "Auto"] },
    { keywords: ["virtual", "hyper", "cstate", "turbo"], options: ["Enabled", "Disabled"] },
    { keywords: ["sata", "raid", "storage"], options: ["AHCI", "RAID", "Auto", "Disabled"] },
  ];

  const deriveSelectableOptions = (name: string, value: any): string[] => {
    const options = new Set<string>();
    const stringValue = String(value ?? "");

    keywordOptionSets.forEach(({ keywords, options: keywordOptions }) => {
      if (keywords.some(keyword => name.toLowerCase().includes(keyword))) {
        keywordOptions.forEach(opt => options.add(opt));
      }
    });

    commonOptionSets.forEach(set => {
      if (set.some(opt => opt.toLowerCase() === stringValue.toLowerCase())) {
        set.forEach(opt => options.add(opt));
      }
    });

    if (stringValue) {
      options.add(stringValue);
    }

    return Array.from(options);
  };

  const renderAttributeEditor = (name: string, value: any) => {
    const selectableOptions = deriveSelectableOptions(name, value);
    const currentValue = editedAttributes[name] ?? value;

    if (selectableOptions.length === 0 || typeof currentValue === 'number') {
      return (
        <Input
          value={currentValue}
          onChange={(e) => handleAttributeChange(name, e.target.value)}
          className="h-9 bg-slate-950/80 border-sky-700 text-sky-100 text-sm focus-visible:ring-sky-500"
        />
      );
    }

    const normalizedOptions = Array.from(new Set(selectableOptions));
    const stringCurrentValue = String(currentValue ?? "");
    const isCustomValue = !normalizedOptions.some(
      opt => opt.toLowerCase() === stringCurrentValue.toLowerCase()
    );
    const selectValue = isCustomValue ? "__other__" : stringCurrentValue;

    const currentCustomValue = customAttributeInputs[name] ?? (isCustomValue ? stringCurrentValue : "");

    return (
      <div className="space-y-2">
        <Select
          value={selectValue}
          onValueChange={(val) => {
            if (val === "__other__") {
              setCustomAttributeInputs(prev => ({
                ...prev,
                [name]: currentCustomValue || stringCurrentValue,
              }));
              handleAttributeChange(name, currentCustomValue || stringCurrentValue);
            } else {
              setCustomAttributeInputs(prev => {
                const updated = { ...prev };
                delete updated[name];
                return updated;
              });
              handleAttributeChange(name, val);
            }
          }}
        >
          <SelectTrigger className="bg-slate-950/80 border-sky-700 text-sky-100 text-sm">
            <SelectValue placeholder="Select option" />
          </SelectTrigger>
          <SelectContent>
            {normalizedOptions.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
            <SelectItem value="__other__">Other (manual)</SelectItem>
          </SelectContent>
        </Select>

        {selectValue === "__other__" && (
          <Input
            value={currentCustomValue}
            onChange={(e) => {
              const newValue = e.target.value;
              setCustomAttributeInputs(prev => ({ ...prev, [name]: newValue }));
              handleAttributeChange(name, newValue);
            }}
            placeholder="Enter custom value"
            className="h-9 bg-slate-950/80 border-sky-700 text-sky-100 text-sm focus-visible:ring-sky-500"
          />
        )}
      </div>
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
              <Button onClick={() => handleCaptureSnapshot()} disabled={capturingSnapshot || loading}>
                {capturingSnapshot ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="ml-2">Capturing...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    <span className="ml-2">Capture Snapshot</span>
                  </>
                )}
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
            <div className="grid gap-4 md:grid-cols-[240px,1fr]">
              <Card className="border-sky-500/40 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-sky-100 shadow-lg">
                <CardContent className="p-4 space-y-3">
                  <div>
                    <p className="text-xs font-mono uppercase text-sky-300">BIOS Setup Wizard</p>
                    <p className="text-[11px] text-sky-200/80">Navigate categories like a BIOS screen and stage changes.</p>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-sky-300" />
                    <Input
                      placeholder="Type to filter attributes"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 text-xs bg-slate-900/80 border-sky-700 text-sky-100 placeholder:text-sky-300/60"
                    />
                  </div>

                  <div className="space-y-1">
                    {wizardCategories.map(category => (
                      <Button
                        key={category.name}
                        variant="ghost"
                        className={`w-full justify-between border text-left font-mono text-[11px] uppercase tracking-tight ${
                          activeWizardCategory === category.name
                            ? 'border-sky-400 bg-sky-900/60 text-white'
                            : 'border-transparent text-sky-200 hover:bg-slate-900'
                        }`}
                        onClick={() => setActiveWizardCategory(category.name)}
                      >
                        <span>{category.name}</span>
                        <Badge variant="outline" className="border-sky-500 text-sky-200 bg-slate-900/80">
                          {category.attributes.length}
                        </Badge>
                      </Button>
                    ))}
                  </div>

                  <div className="text-[11px] text-sky-200/80 leading-relaxed border-t border-sky-800 pt-3">
                    <p className="font-semibold text-sky-100">BIOS Hotkeys</p>
                    <p>← → Category • ↑ ↓ Move • Enter Edit • F10 Save & Queue</p>
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-3">
                <div className="rounded-lg border border-sky-500/40 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-sky-100 shadow-inner">
                  <div className="flex items-center justify-between border-b border-sky-800 px-4 py-3">
                    <div>
                      <p className="font-mono text-sm text-sky-200">Dell PowerEdge BIOS // Interactive Screen</p>
                      <p className="text-[11px] text-sky-300/80">Edit values in-line, staged like a real BIOS menu.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {Object.keys(editedAttributes).length > 0 && (
                        <Badge variant="secondary" className="bg-sky-800 text-sky-50">
                          {Object.keys(editedAttributes).length} pending
                        </Badge>
                      )}
                      <Badge variant="outline" className="border-sky-600 text-sky-200 bg-slate-900/70">
                        {currentConfig?.bios_version ? `BIOS ${currentConfig.bios_version}` : 'Snapshot ready'}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-3 px-4 py-3">
                    <Alert className="bg-slate-900/70 text-sky-100 border-sky-700">
                      <AlertCircle className="h-4 w-4 text-sky-300" />
                      <AlertDescription className="text-sky-100/90">
                        Most BIOS changes require a system reboot to take effect. Changes are staged and applied after reboot.
                      </AlertDescription>
                    </Alert>

                    <ScrollArea className="h-[420px]">
                      {wizardCategories.length === 0 && (
                        <div className="text-sky-200/80 text-sm py-6 text-center">
                          No BIOS configuration captured yet. Take a snapshot first to unlock the wizard view.
                        </div>
                      )}

                      {wizardCategories
                        .filter(category => category.name === activeWizardCategory)
                        .map(category => (
                          <div key={category.name} className="space-y-2">
                            <div className="flex items-center justify-between border-b border-sky-800 pb-2">
                              <p className="font-mono text-xs uppercase text-sky-200">{category.name} Settings</p>
                              <p className="text-[11px] text-sky-300/80">{category.attributes.length} editable fields</p>
                            </div>

                            {category.attributes.map(({ name, value }) => (
                              <div
                                key={name}
                                className="flex items-center justify-between gap-4 rounded border border-sky-900 bg-slate-900/70 px-3 py-2 hover:border-sky-500/60"
                              >
                                <div className="flex-1 space-y-1">
                                  <p className="font-mono text-xs text-sky-100">{name}</p>
                                  <div className="flex items-center gap-2 text-[11px] text-sky-300/80">
                                    <span className="uppercase">Current:</span>
                                    <Badge variant="outline" className="border-sky-700 bg-slate-950 text-sky-100">
                                      {String(value)}
                                    </Badge>
                                    {editedAttributes[name] !== undefined && (
                                      <Badge variant="secondary" className="bg-amber-800/60 text-amber-50">
                                        Pending: {String(editedAttributes[name])}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="w-56">
                                  {typeof value === 'boolean' ? (
                                    <div className="flex items-center justify-end gap-2 text-[11px] text-sky-200/80">
                                      <span>{(editedAttributes[name] ?? value) ? 'Enabled' : 'Disabled'}</span>
                                      <Switch
                                        checked={editedAttributes[name] ?? value}
                                        onCheckedChange={(checked) => handleAttributeChange(name, checked)}
                                      />
                                    </div>
                                  ) : (
                                    renderAttributeEditor(name, value)
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                    </ScrollArea>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
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
