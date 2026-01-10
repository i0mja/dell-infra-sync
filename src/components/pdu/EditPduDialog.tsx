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
import { Loader2 } from 'lucide-react';
import type { Pdu, PduFormData } from '@/types/pdu';

const pduSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  ip_address: z.string().min(1, 'IP address is required'),
  hostname: z.string().optional(),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  protocol: z.enum(['nmc', 'snmp']),
  snmp_community: z.string().optional(),
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
      protocol: 'nmc',
      snmp_community: 'public',
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
              <Label htmlFor="protocol">Protocol</Label>
              <Select
                value={protocol}
                onValueChange={(value: 'nmc' | 'snmp') => setValue('protocol', value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nmc">NMC Web Interface</SelectItem>
                  <SelectItem value="snmp">SNMP</SelectItem>
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

          {protocol === 'snmp' && (
            <div className="space-y-2">
              <Label htmlFor="snmp_community">SNMP Community</Label>
              <Input
                id="snmp_community"
                placeholder="public"
                {...register('snmp_community')}
              />
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
