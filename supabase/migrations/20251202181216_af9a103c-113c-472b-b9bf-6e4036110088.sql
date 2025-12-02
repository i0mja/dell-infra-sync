-- Create managed_users table for direct AD user role assignment
CREATE TABLE public.managed_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_username text NOT NULL,
  ad_domain text NOT NULL,
  display_name text,
  email text,
  app_role app_role NOT NULL DEFAULT 'viewer',
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(ad_username, ad_domain)
);

-- Enable RLS
ALTER TABLE managed_users ENABLE ROW LEVEL SECURITY;

-- Admins can manage users
CREATE POLICY "Admins can manage managed_users" ON managed_users
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
  
-- Authenticated users can view (for login check)
CREATE POLICY "Authenticated users can view managed_users" ON managed_users
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- System can select for login checks (no auth required)
CREATE POLICY "System can select managed_users" ON managed_users
  FOR SELECT USING (true);

-- Add job type for AD user search
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'idm_search_ad_users';

-- Add trigger for updated_at
CREATE TRIGGER update_managed_users_updated_at
  BEFORE UPDATE ON managed_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();