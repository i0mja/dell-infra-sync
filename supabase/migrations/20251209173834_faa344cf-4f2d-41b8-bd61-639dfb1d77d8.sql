-- Create junction table for network-to-VM relationships
CREATE TABLE public.vcenter_network_vms (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    network_id UUID NOT NULL REFERENCES public.vcenter_networks(id) ON DELETE CASCADE,
    vm_id UUID NOT NULL REFERENCES public.vcenter_vms(id) ON DELETE CASCADE,
    source_vcenter_id UUID REFERENCES public.vcenters(id) ON DELETE CASCADE,
    nic_label TEXT,
    mac_address TEXT,
    ip_addresses TEXT[],
    adapter_type TEXT,
    connected BOOLEAN DEFAULT true,
    last_sync TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    -- Unique constraint on network + vm + nic_label to avoid duplicates
    UNIQUE(network_id, vm_id, nic_label)
);

-- Create indexes for common queries
CREATE INDEX idx_vcenter_network_vms_network_id ON public.vcenter_network_vms(network_id);
CREATE INDEX idx_vcenter_network_vms_vm_id ON public.vcenter_network_vms(vm_id);
CREATE INDEX idx_vcenter_network_vms_source_vcenter ON public.vcenter_network_vms(source_vcenter_id);

-- Enable RLS
ALTER TABLE public.vcenter_network_vms ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view network VMs"
ON public.vcenter_network_vms
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage network VMs"
ON public.vcenter_network_vms
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

-- Add comment
COMMENT ON TABLE public.vcenter_network_vms IS 'Junction table tracking which VMs are connected to which networks, including NIC details';