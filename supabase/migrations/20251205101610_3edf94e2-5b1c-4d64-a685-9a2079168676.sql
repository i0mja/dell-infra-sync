-- Clean up duplicate role entries, keeping only highest-privilege role
-- Delete viewer roles where user also has admin role
DELETE FROM user_roles 
WHERE role = 'viewer' 
  AND user_id IN (
    SELECT user_id FROM user_roles WHERE role = 'admin'
  );

-- Delete viewer roles where user also has operator role  
DELETE FROM user_roles 
WHERE role = 'viewer' 
  AND user_id IN (
    SELECT user_id FROM user_roles WHERE role = 'operator'
  );

-- Delete operator roles where user also has admin role
DELETE FROM user_roles 
WHERE role = 'operator' 
  AND user_id IN (
    SELECT user_id FROM user_roles WHERE role = 'admin'
  );