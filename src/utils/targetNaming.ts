import { supabase } from "@/integrations/supabase/client";

/**
 * Auto-generate target and VM names based on site codes with auto-incrementing numbers
 * Format: 
 *   targetName: zfs-{site_code}-vrep-{nn} (e.g., zfs-mar-vrep-01)
 *   vmName: {vm_prefix}-VREP-{nn} (e.g., S06-VREP-01)
 */
export async function generateTargetNames(
  siteCode: string, 
  vmPrefix: string
): Promise<{ targetName: string; vmName: string; datastoreName: string; nextNumber: number }> {
  if (!siteCode) {
    // Fallback if no site code configured
    const timestamp = Date.now().toString(36).slice(-4);
    return {
      targetName: `zfs-target-${timestamp}`,
      vmName: vmPrefix ? `${vmPrefix}-VREP-${timestamp}` : `VREP-${timestamp}`,
      datastoreName: `NFS-zfs-target-${timestamp}`,
      nextNumber: 0,
    };
  }
  
  const siteCodeLower = siteCode.toLowerCase();
  
  // Query existing targets matching the pattern
  const { data: existing } = await supabase
    .from('replication_targets')
    .select('name')
    .ilike('name', `zfs-${siteCodeLower}-vrep-%`);
  
  // Extract numbers and find the highest
  const numbers = (existing || []).map(t => {
    const match = t.name.match(/vrep-(\d+)$/i);
    return match ? parseInt(match[1], 10) : 0;
  });
  
  const nextNum = Math.max(0, ...numbers) + 1;
  const paddedNum = nextNum.toString().padStart(2, '0');
  
  const targetName = `zfs-${siteCodeLower}-vrep-${paddedNum}`;
  const vmName = vmPrefix ? `${vmPrefix}-VREP-${paddedNum}` : `VREP-${paddedNum}`;
  const datastoreName = `NFS-${targetName}`;
  
  return { targetName, vmName, datastoreName, nextNumber: nextNum };
}

/**
 * Get site code and VM prefix from vCenter
 */
export async function getVCenterSiteCodes(vcenterId: string): Promise<{ siteCode: string | null; vmPrefix: string | null }> {
  const { data } = await supabase
    .from('vcenters')
    .select('site_code, vm_prefix')
    .eq('id', vcenterId)
    .single();
  
  return {
    siteCode: data?.site_code || null,
    vmPrefix: data?.vm_prefix || null,
  };
}
