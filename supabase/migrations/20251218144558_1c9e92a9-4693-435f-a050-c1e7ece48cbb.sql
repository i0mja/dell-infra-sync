-- Create function to update datastore vm_count from junction table
CREATE OR REPLACE FUNCTION public.update_datastore_vm_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the vm_count on the affected datastore
  UPDATE public.vcenter_datastores 
  SET vm_count = (
    SELECT COUNT(*) 
    FROM public.vcenter_datastore_vms 
    WHERE datastore_id = COALESCE(NEW.datastore_id, OLD.datastore_id)
  )
  WHERE id = COALESCE(NEW.datastore_id, OLD.datastore_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger to auto-update vm_count when junction table changes
CREATE TRIGGER trigger_update_datastore_vm_count
AFTER INSERT OR UPDATE OR DELETE ON public.vcenter_datastore_vms
FOR EACH ROW
EXECUTE FUNCTION public.update_datastore_vm_count();

-- Backfill existing data - update all datastores with correct VM counts
UPDATE public.vcenter_datastores d
SET vm_count = (
  SELECT COUNT(*) 
  FROM public.vcenter_datastore_vms dv 
  WHERE dv.datastore_id = d.id
);