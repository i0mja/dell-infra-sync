-- Create SSH Keys table for centralized key management
CREATE TABLE public.ssh_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  key_type TEXT NOT NULL DEFAULT 'ed25519',
  public_key TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  private_key_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id),
  activated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles(id),
  revocation_reason TEXT,
  last_used_at TIMESTAMPTZ,
  use_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create SSH Key Deployments table to track key distribution
CREATE TABLE public.ssh_key_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ssh_key_id UUID NOT NULL REFERENCES public.ssh_keys(id) ON DELETE CASCADE,
  replication_target_id UUID REFERENCES public.replication_targets(id) ON DELETE CASCADE,
  zfs_template_id UUID REFERENCES public.zfs_target_templates(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deployed', 'verified', 'failed', 'removed')),
  deployed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  last_error TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ssh_key_deployment_target_check CHECK (
    (replication_target_id IS NOT NULL AND zfs_template_id IS NULL) OR
    (replication_target_id IS NULL AND zfs_template_id IS NOT NULL)
  )
);

-- Add ssh_key_id FK to existing tables
ALTER TABLE public.zfs_target_templates ADD COLUMN ssh_key_id UUID REFERENCES public.ssh_keys(id) ON DELETE SET NULL;
ALTER TABLE public.replication_targets ADD COLUMN ssh_key_id UUID REFERENCES public.ssh_keys(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX idx_ssh_keys_status ON public.ssh_keys(status);
CREATE INDEX idx_ssh_keys_created_by ON public.ssh_keys(created_by);
CREATE INDEX idx_ssh_keys_fingerprint ON public.ssh_keys(public_key_fingerprint);
CREATE INDEX idx_ssh_key_deployments_key ON public.ssh_key_deployments(ssh_key_id);
CREATE INDEX idx_ssh_key_deployments_status ON public.ssh_key_deployments(status);

-- Enable RLS
ALTER TABLE public.ssh_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ssh_key_deployments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ssh_keys
CREATE POLICY "Admins can manage SSH keys"
  ON public.ssh_keys FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Operators can view SSH keys"
  ON public.ssh_keys FOR SELECT
  USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));

-- RLS Policies for ssh_key_deployments
CREATE POLICY "Admins can manage SSH key deployments"
  ON public.ssh_key_deployments FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Operators can view SSH key deployments"
  ON public.ssh_key_deployments FOR SELECT
  USING (has_role(auth.uid(), 'operator') OR has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_ssh_keys_updated_at
  BEFORE UPDATE ON public.ssh_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ssh_key_deployments_updated_at
  BEFORE UPDATE ON public.ssh_key_deployments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();