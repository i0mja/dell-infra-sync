import type { FirmwareComponent } from '@/hooks/useUpdateAvailabilityScan';

export interface GroupedFirmwareComponent extends FirmwareComponent {
  instanceCount: number;
  instanceNames: string[];
}

/**
 * Normalize component name for grouping.
 * Removes MAC addresses, disk/port/slot numbers to allow grouping similar components.
 */
export function normalizeForGrouping(name: string): string {
  let normalized = name;
  // Remove MAC addresses (e.g., "- D4:04:E6:D8:2E:20")
  normalized = normalized.replace(/\s*-\s*([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\s*$/g, '');
  // Remove disk/slot numbers like "Disk 10", "Slot.1", "Slot.2", "Port 1"
  normalized = normalized.replace(/\b(Disk|Port|Slot)\s*\.?\s*\d+\b/gi, '$1');
  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

/**
 * Group firmware components that share the same normalized name, installed version,
 * available version, and type into single entries with instance counts.
 */
export function groupFirmwareComponents(components: FirmwareComponent[]): GroupedFirmwareComponent[] {
  const groups = new Map<string, GroupedFirmwareComponent>();

  components.forEach(comp => {
    const normalizedName = normalizeForGrouping(comp.name);
    const groupKey = `${normalizedName}|${comp.installedVersion}|${comp.availableVersion || ''}|${comp.type}`;
    
    const existing = groups.get(groupKey);
    if (existing) {
      existing.instanceCount++;
      existing.instanceNames.push(comp.name);
      // Preserve most severe status
      if (comp.status === 'critical-update') {
        existing.status = 'critical-update';
      } else if (comp.status === 'update-available' && existing.status !== 'critical-update') {
        existing.status = 'update-available';
      }
      // Preserve highest criticality
      if (comp.criticality === 'Critical') {
        existing.criticality = 'Critical';
      } else if (comp.criticality === 'Recommended' && existing.criticality !== 'Critical') {
        existing.criticality = 'Recommended';
      }
      // If any component in the group was inferred, mark the group as inferred
      if (comp.updateInferred) {
        existing.updateInferred = true;
      }
    } else {
      groups.set(groupKey, {
        ...comp,
        name: normalizedName,
        instanceCount: 1,
        instanceNames: [comp.name],
      });
    }
  });

  // Sort: critical first, then update-available, then by instance count
  return Array.from(groups.values()).sort((a, b) => {
    const statusOrder: Record<string, number> = { 
      'critical-update': 0, 
      'update-available': 1, 
      'not-in-catalog': 2, 
      'up-to-date': 3 
    };
    const statusDiff = (statusOrder[a.status] || 3) - (statusOrder[b.status] || 3);
    if (statusDiff !== 0) return statusDiff;
    return b.instanceCount - a.instanceCount;
  });
}

/**
 * Count unique updates (distinct combinations of normalized name + available version).
 */
export function countUniqueUpdates(components: FirmwareComponent[]): number {
  const uniqueUpdates = new Set<string>();
  components.forEach(c => {
    if (c.availableVersion) {
      const normalized = normalizeForGrouping(c.name);
      uniqueUpdates.add(`${normalized}|${c.availableVersion}`);
    }
  });
  return uniqueUpdates.size;
}
