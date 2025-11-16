import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HardDrive, Network, Disc, Power, RefreshCw, GripVertical, Save, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface BootConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: {
    id: string;
    ip_address: string;
    hostname?: string | null;
    boot_mode?: string | null;
    boot_source_override_enabled?: string | null;
    boot_source_override_target?: string | null;
    boot_order?: string[] | null;
    last_boot_config_check?: string | null;
  };
}

interface SortableBootItemProps {
  id: string;
  device: string;
  index: number;
  isEditing: boolean;
}

function SortableBootItem({ id, device, index, isEditing }: SortableBootItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 p-3 bg-muted rounded-md ${
        isEditing ? 'cursor-move hover:bg-muted/80' : ''
      }`}
    >
      {isEditing && (
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <span className="text-muted-foreground font-mono text-sm">{index + 1}.</span>
      <code className="text-xs bg-background px-2 py-1 rounded flex-1">
        {device}
      </code>
    </div>
  );
}

export function BootConfigDialog({ open, onOpenChange, server }: BootConfigDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState("one-time");
  const [oneTimeTarget, setOneTimeTarget] = useState<string>("None");
  const [bootMode, setBootMode] = useState<string>(server.boot_mode || "UEFI");
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [editableBootOrder, setEditableBootOrder] = useState<string[]>([]);
  const [isEditingBootOrder, setIsEditingBootOrder] = useState(false);
  const [hasBootOrderChanges, setHasBootOrderChanges] = useState(false);
  
  // Initialize editable boot order when server changes or dialog opens
  useEffect(() => {
    if (open && server.boot_order) {
      setEditableBootOrder([...server.boot_order]);
      setIsEditingBootOrder(false);
      setHasBootOrderChanges(false);
    }
  }, [open, server.boot_order]);

  const bootTargets = [
    { value: "None", label: "None", icon: Power },
    { value: "Pxe", label: "Network (PXE)", icon: Network },
    { value: "Hdd", label: "Hard Disk", icon: HardDrive },
    { value: "Cd", label: "CD/DVD", icon: Disc },
    { value: "Usb", label: "USB", icon: HardDrive },
    { value: "BiosSetup", label: "BIOS Setup", icon: Power },
  ];
  
  // Configure drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setEditableBootOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        const newOrder = arrayMove(items, oldIndex, newIndex);
        setHasBootOrderChanges(true);
        return newOrder;
      });
    }
  };

  // Handle save boot order
  const handleSaveBootOrder = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { 
            action: 'set_boot_order',
            boot_order: editableBootOrder
          }
        });

      if (jobError) throw jobError;

      toast.success("Boot order update initiated", {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      setIsEditingBootOrder(false);
      setHasBootOrderChanges(false);
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error setting boot order:', error);
      toast.error('Failed to set boot order', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle cancel edit
  const handleCancelEdit = () => {
    setEditableBootOrder(server.boot_order || []);
    setIsEditingBootOrder(false);
    setHasBootOrderChanges(false);
  };

  const handleFetchConfig = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { action: 'fetch_config' }
        });

      if (jobError) throw jobError;

      toast.success("Fetching boot configuration", {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error fetching boot config:', error);
      toast.error('Failed to fetch boot configuration', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetOneTimeBoot = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { 
            action: 'set_one_time_boot',
            boot_target: oneTimeTarget,
            boot_mode: bootMode
          }
        });

      if (jobError) throw jobError;

      toast.success(`One-time boot set to ${oneTimeTarget}`, {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error setting one-time boot:', error);
      toast.error('Failed to set one-time boot', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDisableOverride = async () => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'boot_configuration',
          created_by: user.id,
          target_scope: {
            type: 'specific',
            server_ids: [server.id]
          },
          details: { action: 'disable_override' }
        });

      if (jobError) throw jobError;

      toast.success("Boot override disabled", {
        description: `Job created for ${server.hostname || server.ip_address}`
      });
      
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error disabling boot override:', error);
      toast.error('Failed to disable boot override', {
        description: error.message
      });
    } finally {
      setIsSubmitting(false);
      setConfirmAction(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Boot Configuration
            </DialogTitle>
            <DialogDescription>
              Manage boot settings for {server.hostname || server.ip_address}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="one-time">One-Time Boot</TabsTrigger>
              <TabsTrigger value="persistent">Boot Order</TabsTrigger>
              <TabsTrigger value="current">Current Config</TabsTrigger>
            </TabsList>

            {/* One-Time Boot Tab */}
            <TabsContent value="one-time" className="space-y-4">
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Boot Device</Label>
                  <Select value={oneTimeTarget} onValueChange={setOneTimeTarget}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select boot device" />
                    </SelectTrigger>
                    <SelectContent>
                      {bootTargets.map((target) => {
                        const Icon = target.icon;
                        return (
                          <SelectItem key={target.value} value={target.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" />
                              {target.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Device to boot from on next restart only
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Boot Mode</Label>
                  <Select value={bootMode} onValueChange={setBootMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UEFI">UEFI</SelectItem>
                      <SelectItem value="Legacy">Legacy BIOS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    <strong>Note:</strong> One-time boot will only affect the next system restart. 
                    After that, the server will revert to its configured boot order.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button onClick={handleSetOneTimeBoot} disabled={isSubmitting || oneTimeTarget === "None"}>
                  {isSubmitting ? "Applying..." : "Set One-Time Boot"}
                </Button>
              </DialogFooter>
            </TabsContent>

            {/* Persistent Boot Order Tab */}
            <TabsContent value="persistent" className="space-y-4">
              <div className="space-y-4 py-4">
                {/* Header with Edit/Save buttons */}
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Persistent Boot Order</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Drag devices to reorder. This changes the permanent boot sequence.
                    </p>
                  </div>
                  {!isEditingBootOrder && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingBootOrder(true)}
                      disabled={!server.boot_order || server.boot_order.length === 0}
                    >
                      Edit Order
                    </Button>
                  )}
                </div>

                {/* Boot Order List */}
                {server.boot_order && server.boot_order.length > 0 ? (
                  <div className="space-y-2">
                    {isEditingBootOrder ? (
                      // Drag-and-drop mode
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext
                          items={editableBootOrder}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="space-y-2">
                            {editableBootOrder.map((device, index) => (
                              <SortableBootItem
                                key={device}
                                id={device}
                                device={device}
                                index={index}
                                isEditing={true}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    ) : (
                      // Read-only mode
                      <div className="space-y-2">
                        {(server.boot_order || []).map((device, index) => (
                          <div key={device} className="flex items-center gap-2 p-3 bg-muted rounded-md">
                            <span className="text-muted-foreground font-mono text-sm">{index + 1}.</span>
                            <code className="text-xs bg-background px-2 py-1 rounded flex-1">
                              {device}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p className="text-sm">No boot order information available</p>
                    <p className="text-xs mt-1">Click "Refresh" to fetch boot configuration</p>
                  </div>
                )}

                {/* Warning when editing */}
                {isEditingBootOrder && (
                  <div className="bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>Warning:</strong> Changes to boot order are permanent and will affect all future boots. 
                      The server may need to be restarted for changes to take effect.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                {isEditingBootOrder ? (
                  <>
                    <Button variant="outline" onClick={handleCancelEdit} disabled={isSubmitting}>
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleSaveBootOrder} 
                      disabled={isSubmitting || !hasBootOrderChanges}
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isSubmitting ? "Saving..." : "Save Boot Order"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                      Close
                    </Button>
                    <Button onClick={handleFetchConfig} disabled={isSubmitting}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Refresh
                    </Button>
                  </>
                )}
              </DialogFooter>
            </TabsContent>

            {/* Current Configuration Tab */}
            <TabsContent value="current" className="space-y-4">
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Boot Mode</Label>
                    <div className="font-mono text-sm">{server.boot_mode || 'Unknown'}</div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Override Status</Label>
                    <Badge variant={server.boot_source_override_enabled === 'Disabled' ? 'outline' : 'default'}>
                      {server.boot_source_override_enabled || 'Unknown'}
                    </Badge>
                  </div>
                </div>

                {server.boot_source_override_enabled && server.boot_source_override_enabled !== 'Disabled' && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Override Target</Label>
                    <div className="font-mono text-sm">{server.boot_source_override_target || 'None'}</div>
                  </div>
                )}

                {server.last_boot_config_check && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Last Updated</Label>
                    <div className="text-sm">
                      {new Date(server.last_boot_config_check).toLocaleString()}
                    </div>
                  </div>
                )}

                <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-3">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Tip:</strong> Use the "Boot Order" tab to permanently change the boot sequence, 
                    or "One-Time Boot" for temporary changes.
                  </p>
                </div>
              </div>

              <DialogFooter className="flex justify-between">
                <div className="flex gap-2">
                  {server.boot_source_override_enabled !== 'Disabled' && (
                    <Button
                      variant="outline"
                      onClick={() => setConfirmAction('disable_override')}
                      disabled={isSubmitting}
                    >
                      Disable Override
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                    Close
                  </Button>
                  <Button onClick={handleFetchConfig} disabled={isSubmitting}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                  </Button>
                </div>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmAction !== null} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disable the boot override? The server will boot from its configured boot order on next restart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableOverride} disabled={isSubmitting}>
              {isSubmitting ? "Disabling..." : "Disable Override"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
