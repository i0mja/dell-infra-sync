-- Clean up orphaned adm_jalexander records
-- User ID: 6d2cb4c8-dcd6-49ad-b16b-57d56a1e46c5

-- Get an alternate admin to reassign records to
DO $$
DECLARE
  alt_admin_id uuid;
  orphan_id uuid := '6d2cb4c8-dcd6-49ad-b16b-57d56a1e46c5';
BEGIN
  -- Find another admin user
  SELECT user_id INTO alt_admin_id 
  FROM public.user_roles 
  WHERE role = 'admin' AND user_id != orphan_id 
  LIMIT 1;

  -- Reassign jobs
  UPDATE public.jobs SET created_by = alt_admin_id WHERE created_by = orphan_id;
  
  -- Nullify audit_logs (preserves history)
  UPDATE public.audit_logs SET user_id = NULL WHERE user_id = orphan_id;
  
  -- Nullify bios_configurations
  UPDATE public.bios_configurations SET created_by = NULL WHERE created_by = orphan_id;
  
  -- Nullify firmware_packages
  UPDATE public.firmware_packages SET created_by = NULL WHERE created_by = orphan_id;
  
  -- Nullify iso_images
  UPDATE public.iso_images SET created_by = NULL WHERE created_by = orphan_id;
  
  -- Nullify esxi_upgrade_profiles
  UPDATE public.esxi_upgrade_profiles SET created_by = NULL WHERE created_by = orphan_id;
  
  -- Nullify maintenance_windows
  UPDATE public.maintenance_windows SET created_by = NULL, approved_by = NULL WHERE created_by = orphan_id OR approved_by = orphan_id;
  
  -- Nullify break_glass_admins
  UPDATE public.break_glass_admins SET created_by = NULL, activated_by = NULL WHERE created_by = orphan_id OR activated_by = orphan_id;
  
  -- Nullify managed_users
  UPDATE public.managed_users SET created_by = NULL WHERE created_by = orphan_id;
  
  -- Nullify idm_auth_sessions
  UPDATE public.idm_auth_sessions SET user_id = NULL WHERE user_id = orphan_id;
  
  -- Delete user_roles
  DELETE FROM public.user_roles WHERE user_id = orphan_id;
  
  -- Delete profile
  DELETE FROM public.profiles WHERE id = orphan_id;
END $$;