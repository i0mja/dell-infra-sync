-- Add DELETE policy for jobs table (admins and operators only)
CREATE POLICY "Admins and operators can delete jobs"
  ON public.jobs
  FOR DELETE
  TO public
  USING (
    has_role(auth.uid(), 'admin'::app_role) 
    OR has_role(auth.uid(), 'operator'::app_role)
  );