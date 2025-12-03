-- Delete the orphaned auth.users entry for adm_jalexander
-- The profile and user_roles were already deleted, but auth.users remains
-- We need to use auth.users directly since the service role has access

-- First verify this is the right user by checking there's no profile
DO $$
DECLARE
  user_id_to_delete uuid := '6d2cb4c8-dcd6-49ad-b16b-57d56a1e46c5';
  profile_exists boolean;
BEGIN
  -- Check if profile exists (it shouldn't)
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = user_id_to_delete) INTO profile_exists;
  
  IF profile_exists THEN
    RAISE NOTICE 'Profile still exists for user %, skipping deletion', user_id_to_delete;
  ELSE
    RAISE NOTICE 'Profile does not exist for user %, proceeding with auth.users deletion', user_id_to_delete;
    -- Delete from auth.users - this will cascade to auth.identities, auth.sessions, etc.
    DELETE FROM auth.users WHERE id = user_id_to_delete;
    RAISE NOTICE 'Deleted auth.users entry for %', user_id_to_delete;
  END IF;
END $$;