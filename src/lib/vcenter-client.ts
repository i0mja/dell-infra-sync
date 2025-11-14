import { supabase } from "@/integrations/supabase/client";

export interface VCenterSettings {
  host: string;
  username: string;
  password: string;
  port: number;
  verify_ssl: boolean;
}

export interface TestVCenterResult {
  success: boolean;
  responseTime: number;
  version?: string;
  error?: string;
}

export interface SyncVCenterResult {
  success: boolean;
  summary: {
    new: number;
    updated: number;
    linked: number;
    errors: number;
  };
  errors: string[];
}

export async function testVCenterConnection(
  settings?: Partial<VCenterSettings>
): Promise<TestVCenterResult> {
  const startTime = Date.now();
  
  try {
    let vcenterSettings: VCenterSettings;
    
    if (settings?.host && settings?.username && settings?.password) {
      vcenterSettings = {
        host: settings.host,
        username: settings.username,
        password: settings.password,
        port: settings.port || 443,
        verify_ssl: settings.verify_ssl ?? false,
      };
    } else {
      const { data, error } = await supabase
        .from('vcenter_settings')
        .select('*')
        .maybeSingle();
      
      if (error || !data) {
        return {
          success: false,
          responseTime: Date.now() - startTime,
          error: 'vCenter settings not configured',
        };
      }
      
      vcenterSettings = data;
    }
    
    const baseUrl = `https://${vcenterSettings.host}:${vcenterSettings.port}`;
    
    // Create session with vCenter
    const authResponse = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${vcenterSettings.username}:${vcenterSettings.password}`)}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!authResponse.ok) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
        error: `vCenter authentication failed: ${authResponse.status}`,
      };
    }
    
    const sessionToken = await authResponse.text();
    const sessionId = sessionToken.replace(/"/g, '');
    
    // Get vCenter version
    const versionResponse = await fetch(`${baseUrl}/api/vcenter/system/version`, {
      headers: {
        'vmware-api-session-id': sessionId,
      },
    });
    
    let version = 'Unknown';
    if (versionResponse.ok) {
      const versionData = await versionResponse.json();
      version = versionData.version || 'Unknown';
    }
    
    // Update last_sync timestamp
    if (!settings?.host) {
      const { data: settingsRecord } = await supabase
        .from('vcenter_settings')
        .select('id')
        .maybeSingle();
      
      if (settingsRecord) {
        await supabase
          .from('vcenter_settings')
          .update({ last_sync: new Date().toISOString() })
          .eq('id', settingsRecord.id);
      }
    }
    
    return {
      success: true,
      responseTime: Date.now() - startTime,
      version,
    };
  } catch (error: any) {
    return {
      success: false,
      responseTime: Date.now() - startTime,
      error: error.message,
    };
  }
}

export async function syncVCenter(): Promise<SyncVCenterResult> {
  try {
    // Fetch vCenter settings
    const { data: settings, error: settingsError } = await supabase
      .from('vcenter_settings')
      .select('*')
      .maybeSingle();
    
    if (settingsError || !settings) {
      return {
        success: false,
        summary: { new: 0, updated: 0, linked: 0, errors: 1 },
        errors: ['vCenter settings not configured'],
      };
    }
    
    const vcenterSettings: VCenterSettings = settings;
    const baseUrl = `https://${vcenterSettings.host}:${vcenterSettings.port}`;
    
    // Authenticate
    const authResponse = await fetch(`${baseUrl}/api/session`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${vcenterSettings.username}:${vcenterSettings.password}`)}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!authResponse.ok) {
      throw new Error(`vCenter authentication failed: ${authResponse.status}`);
    }
    
    const sessionToken = await authResponse.text();
    const sessionId = sessionToken.replace(/"/g, '');
    const vcenterHeaders = { 'vmware-api-session-id': sessionId };
    
    let newHosts = 0;
    let updatedHosts = 0;
    let linkedServers = 0;
    const errors: string[] = [];
    
    // Fetch clusters
    const clustersResponse = await fetch(`${baseUrl}/api/vcenter/cluster`, {
      headers: vcenterHeaders,
    });
    
    if (!clustersResponse.ok) {
      throw new Error('Failed to fetch clusters');
    }
    
    const clusters = await clustersResponse.json();
    
    // Fetch hosts
    const hostsResponse = await fetch(`${baseUrl}/api/vcenter/host`, {
      headers: vcenterHeaders,
    });
    
    if (!hostsResponse.ok) {
      throw new Error('Failed to fetch hosts');
    }
    
    const hosts = await hostsResponse.json();
    
    // Process each host
    for (const hostSummary of hosts) {
      try {
        // Get detailed host information
        const hostDetailResponse = await fetch(
          `${baseUrl}/api/vcenter/host/${hostSummary.host}`,
          { headers: vcenterHeaders }
        );
        
        if (!hostDetailResponse.ok) continue;
        
        const hostDetail = await hostDetailResponse.json();
        
        // Find cluster name
        const cluster = clusters.find((c: any) => 
          hostDetail.cluster === c.cluster
        );
        
        const hostData = {
          name: hostSummary.name,
          cluster: cluster?.name || null,
          vcenter_id: hostSummary.host,
          serial_number: hostDetail.hardware?.serial_number || null,
          esxi_version: hostDetail.product?.version || null,
          status: hostSummary.connection_state === 'CONNECTED' ? 'connected' : 'disconnected',
          maintenance_mode: hostDetail.maintenance_mode || false,
          last_sync: new Date().toISOString(),
        };
        
        // Check if host exists
        const { data: existingHost } = await supabase
          .from('vcenter_hosts')
          .select('id, server_id')
          .eq('vcenter_id', hostData.vcenter_id)
          .maybeSingle();
        
        if (existingHost) {
          // Update existing host
          await supabase
            .from('vcenter_hosts')
            .update(hostData)
            .eq('id', existingHost.id);
          updatedHosts++;
        } else {
          // Insert new host
          await supabase
            .from('vcenter_hosts')
            .insert([hostData]);
          newHosts++;
        }
        
        // Try to auto-link to server by serial number
        if (hostData.serial_number) {
          const { data: matchingServer } = await supabase
            .from('servers')
            .select('id, vcenter_host_id')
            .eq('service_tag', hostData.serial_number)
            .is('vcenter_host_id', null)
            .maybeSingle();
          
          if (matchingServer) {
            const { data: vhost } = await supabase
              .from('vcenter_hosts')
              .select('id')
              .eq('vcenter_id', hostData.vcenter_id)
              .single();
            
            if (vhost) {
              await supabase
                .from('servers')
                .update({ vcenter_host_id: vhost.id })
                .eq('id', matchingServer.id);
              
              await supabase
                .from('vcenter_hosts')
                .update({ server_id: matchingServer.id })
                .eq('id', vhost.id);
              
              linkedServers++;
            }
          }
        }
      } catch (error: any) {
        errors.push(`Error processing host ${hostSummary.name}: ${error.message}`);
      }
    }
    
    // Update last sync timestamp
    await supabase
      .from('vcenter_settings')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', settings.id);
    
    return {
      success: true,
      summary: { new: newHosts, updated: updatedHosts, linked: linkedServers, errors: errors.length },
      errors,
    };
  } catch (error: any) {
    return {
      success: false,
      summary: { new: 0, updated: 0, linked: 0, errors: 1 },
      errors: [error.message],
    };
  }
}
