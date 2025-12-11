import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Star, CheckCircle2, AlertCircle, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ZfsTemplate {
  id: string;
  name: string;
  template_name: string;
  is_active: boolean;
  vcenter_id?: string;
  default_cluster?: string;
  default_datastore?: string;
  ssh_key_id?: string;
  created_at: string;
}

interface GoldImageSelectorProps {
  vcenterId?: string;
  selectedTemplateId?: string;
  onTemplateChange: (templateId: string | undefined) => void;
  disabled?: boolean;
  showLabel?: boolean;
}

export function GoldImageSelector({
  vcenterId,
  selectedTemplateId,
  onTemplateChange,
  disabled = false,
  showLabel = true,
}: GoldImageSelectorProps) {
  const [templates, setTemplates] = useState<ZfsTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoading(true);
      try {
        // Fetch templates - either for this vCenter or global (no vcenter_id)
        let query = supabase
          .from('zfs_target_templates')
          .select('id, name, template_name, is_active, vcenter_id, default_cluster, default_datastore, ssh_key_id, created_at')
          .eq('is_active', true)
          .order('name');

        const { data, error } = await query;

        if (error) throw error;

        // Filter: show templates for this vCenter or global templates
        const filtered = (data || []).filter(t => 
          !t.vcenter_id || t.vcenter_id === vcenterId
        );
        
        setTemplates(filtered);
      } catch (err) {
        console.error('Error fetching templates:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [vcenterId]);

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  return (
    <div className="space-y-2">
      {showLabel && (
        <Label className="flex items-center gap-2">
          <Star className="h-4 w-4 text-yellow-500" />
          Default ZFS Appliance Template (Gold Image)
        </Label>
      )}
      
      <Select 
        value={selectedTemplateId || "none"} 
        onValueChange={(v) => onTemplateChange(v === "none" ? undefined : v)}
        disabled={disabled || loading}
      >
        <SelectTrigger>
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading templates...
            </div>
          ) : (
            <SelectValue placeholder="Select a default template" />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            <span className="text-muted-foreground">No default template</span>
          </SelectItem>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                <span>{template.name}</span>
                {template.vcenter_id === vcenterId && (
                  <Badge variant="secondary" className="text-xs">This vCenter</Badge>
                )}
                {!template.vcenter_id && (
                  <Badge variant="outline" className="text-xs">Global</Badge>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedTemplate && (
        <div className="p-3 rounded-lg bg-muted/50 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="font-medium">{selectedTemplate.name}</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1 pl-6">
            <div>VMware Template: {selectedTemplate.template_name}</div>
            {selectedTemplate.default_cluster && (
              <div>Default Cluster: {selectedTemplate.default_cluster}</div>
            )}
            {selectedTemplate.default_datastore && (
              <div>Default Datastore: {selectedTemplate.default_datastore}</div>
            )}
            {selectedTemplate.ssh_key_id ? (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                SSH Key configured
              </div>
            ) : (
              <div className="flex items-center gap-1 text-yellow-600">
                <AlertCircle className="h-3 w-3" />
                No SSH key - deployments will require password
              </div>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        When set, deployment wizards will auto-fill settings from this template.
      </p>
    </div>
  );
}