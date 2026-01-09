import type { ServerNic } from "@/hooks/useServerNics";

/**
 * Formats network speed from Mbps to human-readable format
 */
export function formatNicSpeed(mbps: number | null): string {
  if (!mbps) return "";
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(0)}G`;
  }
  return `${mbps}M`;
}

/**
 * Formats network speed with full units (e.g., "10 Gbps")
 */
export function formatNicSpeedFull(mbps: number | null): string {
  if (!mbps) return "N/A";
  if (mbps >= 1000) {
    return `${mbps / 1000} Gbps`;
  }
  return `${mbps} Mbps`;
}

/**
 * Formats NIC FQDD and model into a human-readable port name.
 * Uses model field to detect adapter type (OCP, rNDC, NDC, LOM).
 * 
 * Examples:
 * - NIC.Integrated.1-1-1 + "BRCM 4P 10G OCP NIC" → "OCP Port 1"
 * - NIC.Integrated.1-2-1 + "BRCM 2P rNDC" → "rNDC Port 2"
 * - NIC.Integrated.1-1-1 + "Intel X520" → "LOM Port 1"
 * - NIC.Slot.2-1-1 → "Slot 2 Port 1"
 * - FC.Slot.1-1 → "FC Slot 1 Port 1"
 */
export function formatNicName(nic: ServerNic): string {
  const fqdd = nic.fqdd;
  const model = nic.model?.toUpperCase() || '';
  
  // FC adapters: FC.Slot.1-1 → "FC Slot 1 Port 1"
  const fcMatch = fqdd.match(/FC\.Slot\.(\d+)-(\d+)/);
  if (fcMatch) {
    return `FC Slot ${fcMatch[1]} Port ${fcMatch[2]}`;
  }
  
  // Embedded NICs: NIC.Embedded.1-1-1 → "Embedded 1 Port 1"
  // These are typically dedicated management or secondary adapter NICs
  const embMatch = fqdd.match(/NIC\.Embedded\.(\d+)-(\d+)-(\d+)/);
  if (embMatch) {
    return `Embedded ${embMatch[1]} Port ${embMatch[2]}`;
  }
  
  // Integrated NICs: Check model to determine actual adapter type
  // NIC.Integrated.1-2-1 → check model for OCP/rNDC/NDC, default to LOM
  const intMatch = fqdd.match(/NIC\.Integrated\.(\d+)-(\d+)-(\d+)/);
  if (intMatch) {
    const portNum = intMatch[2];
    
    // OCP (Open Compute Project) adapters - modern high-speed NICs in OCP 3.0 slot
    if (model.includes('OCP')) {
      return `OCP Port ${portNum}`;
    }
    
    // rNDC (Rack Network Daughter Card) - modular network cards
    if (model.includes('RNDC') || model.includes('R NDC')) {
      return `rNDC Port ${portNum}`;
    }
    
    // NDC (Network Daughter Card) - older generation modular cards
    // Check for NDC but exclude rNDC matches
    if (model.includes('NDC') && !model.includes('RNDC') && !model.includes('R NDC')) {
      return `NDC Port ${portNum}`;
    }
    
    // Default to LOM for true integrated/onboard NICs
    return `LOM Port ${portNum}`;
  }
  
  // PCIe slot NICs: NIC.Slot.2-1-1 → "Slot 2 Port 1"
  const slotMatch = fqdd.match(/NIC\.Slot\.(\d+)-(\d+)/);
  if (slotMatch) {
    return `Slot ${slotMatch[1]} Port ${slotMatch[2]}`;
  }
  
  // Fallback to model or cleaned FQDD
  return nic.model || fqdd.split(".").pop() || fqdd;
}

/**
 * Determines the NIC adapter type from the model string
 */
export function getNicAdapterType(model: string | null): 'ocp' | 'rndc' | 'ndc' | 'lom' | 'pcie' | 'fc' | 'embedded' | 'unknown' {
  if (!model) return 'unknown';
  
  const upperModel = model.toUpperCase();
  
  if (upperModel.includes('OCP')) return 'ocp';
  if (upperModel.includes('RNDC') || upperModel.includes('R NDC')) return 'rndc';
  if (upperModel.includes('NDC')) return 'ndc';
  
  return 'unknown';
}

/**
 * Abbreviates common NIC manufacturer names for compact display
 */
export function formatManufacturer(manufacturer: string | null): string {
  if (!manufacturer) return '';
  
  const abbreviations: Record<string, string> = {
    'broadcom inc. and subsidiaries': 'Broadcom',
    'broadcom limited': 'Broadcom',
    'broadcom corporation': 'Broadcom',
    'intel corporation': 'Intel',
    'emulex corporation': 'Emulex',
    'qlogic corp.': 'QLogic',
    'qlogic corporation': 'QLogic',
    'dell': 'Dell',
    'mellanox technologies': 'Mellanox',
    'nvidia': 'NVIDIA',
    'marvell semiconductor': 'Marvell',
    'cavium networks': 'Cavium',
  };
  
  const lower = manufacturer.toLowerCase().trim();
  return abbreviations[lower] || manufacturer;
}

/**
 * Extracts the short model/chip identifier from a full model string
 * e.g., "BRCM 2P 10G BT 57416 OCP NIC" → "57416"
 */
export function formatShortModel(model: string | null): string {
  if (!model) return '';
  
  // Extract chip/model number patterns like "57416", "X710", "I350", "LPe31002", "QLE2692"
  const chipMatch = model.match(/\b(5\d{4}|X\d{3}[A-Z]*\d*|I\d{3}|LPe\d+|QLE\d+|QL\d+|BCM\d+|MT\d+|XXV\d+|E810)/i);
  if (chipMatch) return chipMatch[1];
  
  return '';
}
