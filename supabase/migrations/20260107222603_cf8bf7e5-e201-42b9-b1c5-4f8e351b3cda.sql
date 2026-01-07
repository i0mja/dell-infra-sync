-- Clean up duplicate roles: keep only the highest priority role per user
-- Priority: admin > operator > viewer

-- Delete viewer roles for users who also have admin
DELETE FROM user_roles 
WHERE role = 'viewer' 
  AND user_id IN (
    SELECT user_id FROM user_roles WHERE role = 'admin'
  );

-- Delete viewer roles for users who also have operator  
DELETE FROM user_roles 
WHERE role = 'viewer' 
  AND user_id IN (
    SELECT user_id FROM user_roles WHERE role = 'operator'
  );

-- Delete operator roles for users who also have admin
DELETE FROM user_roles 
WHERE role = 'operator' 
  AND user_id IN (
    SELECT user_id FROM user_roles WHERE role = 'admin'
  );