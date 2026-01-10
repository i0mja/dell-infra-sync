import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { Pdu, PduFormData } from '@/types/pdu';

const pduSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  ip_address: z.string().min(1, 'IP address is required'),
  hostname: z.string().optional(),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  protocol: z.enum(['nmc', 'snmp', 'auto']),
  snmp_community: z.string().optional(),
  snmp_write_community: z.string().optional(),
  total_outlets: z.number().min(1).max(48),
  datacenter: z.string().optional(),
  rack_id: z.string().optional(),
  notes: z.string().optional(),
});

interface EditPduDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdu: Pdu | null;
  onSubmit: (id: string, data: Partial<PduFormData>) => Promise<void>;
}

export function EditPduDialog({ open, onOpenChange, pdu, onSubmit }: EditPduDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<PduFormData>({
    resolver: zodResolver(pduSchema),
    defaultValues: {
      name: '',
      ip_address: '',
      hostname: '',
      username: 'apc',
      password: '',
      protocol: 'auto',
      snmp_community: 'public',
      snmp_write_community: 'private',
      total_outlets: 8,
      datacenter: '',
      rack_id: '',
      notes: '',
    },
  });

  const protocol = watch('protocol');

  useEffect(() => {
    if (pdu) {
      reset({
        name: pdu.name,
        ip_address: pdu.ip_address,
        hostname: pdu.hostname || '',
        username: pdu.username || 'apc',
        password: '', // Don't populate password
        protocol: pdu.protocol,
        snmp_community: pdu.snmp_community || 'public',
        snmp_write_community: pdu.snmp_write_community || 'private',
        total_outlets: pdu.total_outlets,
        datacenter: pdu.datacenter || '',
        rack_id: pdu.rack_id || '',
        notes: pdu.notes || '',
      });
    }
  }, [pdu, reset]);

  const handleFormSubmit = async (data: PduFormData) => {
    if (!pdu) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(pdu.id, data);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!pdu) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit PDU</DialogTitle>
          <DialogDescription>
            Update settings for {pdu.name}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Rack-A1-PDU-1"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ip_address">IP Address *</Label>
              <Input
                id="ip_address"
                placeholder="e.g., 192.168.1.100"
                {...register('ip_address')}
              />
              {errors.ip_address && (
                <p className="text-xs text-destructive">{errors.ip_address.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                placeholder="apc"
                {...register('username')}
              />
              {errors.username && (
                <p className="text-xs text-destructive">{errors.username.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Leave blank to keep current"
                {...register('password')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="protocol">Protocol</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      <p><strong>Auto (Recommended):</strong> Tries NMC first, falls back to SNMP if session is blocked.</p>
                      <p className="mt-1"><strong>SNMP:</strong> No session limits, best for concurrent access.</p>
                      <p className="mt-1"><strong>NMC:</strong> Web interface only, may fail if another session is active.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Select
                value={protocol}
                onValueChange={(value: 'nmc' | 'snmp' | 'auto') => setValue('protocol', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Recommended)</SelectItem>
                  <SelectItem value="snmp">SNMP Only</SelectItem>
                  <SelectItem value="nmc">NMC Web Interface Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="total_outlets">Total Outlets</Label>
              <Select
                value={String(watch('total_outlets'))}
                onValueChange={(value) => setValue('total_outlets', parseInt(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8">8 Outlets</SelectItem>
                  <SelectItem value="16">16 Outlets</SelectItem>
                  <SelectItem value="24">24 Outlets</SelectItem>
                  <SelectItem value="42">42 Outlets</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {(protocol === 'snmp' || protocol === 'auto') && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="snmp_community">SNMP Read Community</Label>
                <Input
                  id="snmp_community"
                  placeholder="public"
                  {...register('snmp_community')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="snmp_write_community">SNMP Write Community</Label>
                <Input
                  id="snmp_write_community"
                  placeholder="private"
                  {...register('snmp_write_community')}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="datacenter">Datacenter</Label>
              <Input
                id="datacenter"
                placeholder="e.g., DC-1"
                {...register('datacenter')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rack_id">Rack ID</Label>
              <Input
                id="rack_id"
                placeholder="e.g., A1"
                {...register('rack_id')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Optional notes..."
              rows={2}
              {...register('notes')}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
