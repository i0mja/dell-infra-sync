/**
 * PDU (Power Distribution Unit) types for Schneider Electric/APC management
 */

export interface Pdu {
  id: string;
  name: string;
  ip_address: string;
  hostname?: string;
  model?: string;
  manufacturer: string;
  firmware_version?: string;
  total_outlets: number;
  username: string;
  password_encrypted?: string;
  protocol: 'nmc' | 'snmp' | 'auto';
  snmp_community: string;
  snmp_write_community?: string;
  connection_status: 'online' | 'offline' | 'unknown' | 'error';
  last_seen?: string;
  last_sync?: string;
  datacenter?: string;
  rack_id?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface PduOutlet {
  id: string;
  pdu_id: string;
  outlet_number: number;
  outlet_name?: string;
  outlet_state: 'on' | 'off' | 'unknown';
  last_state_change?: string;
  last_updated: string;
}

export interface ServerPduMapping {
  id: string;
  server_id: string;
  pdu_id: string;
  outlet_number: number;
  feed_label: 'A' | 'B';
  notes?: string;
  created_at: string;
  // Joined fields
  pdu?: Pdu;
  outlet?: PduOutlet;
}

export interface PduFormData {
  name: string;
  ip_address: string;
  hostname?: string;
  username: string;
  password?: string;
  protocol: 'nmc' | 'snmp' | 'auto';
  snmp_community?: string;
  snmp_write_community?: string;
  datacenter?: string;
  rack_id?: string;
  notes?: string;
}

export type OutletAction = 'on' | 'off' | 'reboot' | 'status';

export interface PduOutletControlRequest {
  pdu_id: string;
  outlet_numbers: number[];
  action: OutletAction;
}

// PDU Instant API Response Types
export interface PduTestConnectionResponse {
  success: boolean;
  pdu_id?: string;
  pdu_name?: string;
  ip_address?: string;
  protocol_used?: 'snmp' | 'nmc';
  message?: string;
  error?: string;
  nmc_blocked?: boolean;
}

export interface PduDiscoverResponse {
  success: boolean;
  pdu_id?: string;
  pdu_name?: string;
  discovered?: {
    model?: string | null;
    firmware_version?: string | null;
    total_outlets?: number | null;
    serial_number?: string | null;
  };
  protocol_used?: 'snmp' | 'nmc';
  nmc_blocked?: boolean;
  error?: string;
}

export interface PduOutletControlResponse {
  success: boolean;
  pdu_id?: string;
  outlets?: number[];
  action?: string;
  results?: Array<{ outlet: number; success: boolean; state?: string; error?: string }>;
  protocol_used?: 'snmp' | 'nmc';
  nmc_blocked?: boolean;
  error?: string;
}

export interface PduSyncStatusResponse {
  success: boolean;
  pdu_id?: string;
  pdu_name?: string;
  outlet_count?: number;
  outlets?: Array<{ outlet_number: number; state: string }>;
  protocol_used?: 'snmp' | 'nmc';
  nmc_blocked?: boolean;
  error?: string;
}
