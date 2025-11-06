import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initTestSupabase,
  createTestUser,
  signInTestUser,
  cleanupTestUser,
  getTestSupabase,
} from '../helpers/supabase-helpers';
import { createTestServer, generateRandomIP, generateServiceTag } from '../helpers/test-factories';

describe('Server Management Integration Tests', () => {
  beforeAll(async () => {
    initTestSupabase();
    await createTestUser('admin');
    await signInTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser();
  });

  describe('Server CRUD Operations', () => {
    it('should create a new server', async () => {
      const supabase = getTestSupabase();
      const serverData = createTestServer({
        hostname: 'test-server-create',
        ip_address: generateRandomIP(),
        service_tag: generateServiceTag(),
      });

      const { data: server, error } = await supabase
        .from('servers')
        .insert(serverData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(server).toBeDefined();
      expect(server?.hostname).toBe('test-server-create');
      expect(server?.ip_address).toBe(serverData.ip_address);
      expect(server?.service_tag).toBe(serverData.service_tag);
    });

    it('should read server by ID', async () => {
      const supabase = getTestSupabase();

      // Create server
      const { data: createdServer } = await supabase
        .from('servers')
        .insert(createTestServer())
        .select()
        .single();

      // Read server
      const { data: server, error } = await supabase
        .from('servers')
        .select('*')
        .eq('id', createdServer!.id)
        .single();

      expect(error).toBeNull();
      expect(server).toBeDefined();
      expect(server?.id).toBe(createdServer!.id);
    });

    it('should update server details', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert(createTestServer())
        .select()
        .single();

      const updatedData = {
        hostname: 'updated-hostname',
        notes: 'Updated test notes',
        memory_gb: 128,
        cpu_count: 32,
      };

      const { data: updatedServer, error } = await supabase
        .from('servers')
        .update(updatedData)
        .eq('id', server!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updatedServer?.hostname).toBe('updated-hostname');
      expect(updatedServer?.notes).toBe('Updated test notes');
      expect(updatedServer?.memory_gb).toBe(128);
      expect(updatedServer?.cpu_count).toBe(32);
    });

    it('should delete a server', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert(createTestServer())
        .select()
        .single();

      const { error: deleteError } = await supabase
        .from('servers')
        .delete()
        .eq('id', server!.id);

      expect(deleteError).toBeNull();

      // Verify deletion
      const { data: deletedServer } = await supabase
        .from('servers')
        .select()
        .eq('id', server!.id)
        .maybeSingle();

      expect(deletedServer).toBeNull();
    });
  });

  describe('Server Connection Status', () => {
    it('should update connection status', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert(createTestServer({ connection_status: 'online' }))
        .select()
        .single();

      const { data: updated, error } = await supabase
        .from('servers')
        .update({
          connection_status: 'offline',
          connection_error: 'Timeout',
          last_connection_test: new Date().toISOString(),
        })
        .eq('id', server!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated?.connection_status).toBe('offline');
      expect(updated?.connection_error).toBe('Timeout');
      expect(updated?.last_connection_test).toBeDefined();
    });

    it('should update last_seen timestamp', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert(createTestServer())
        .select()
        .single();

      const lastSeen = new Date().toISOString();
      const { data: updated, error } = await supabase
        .from('servers')
        .update({ last_seen: lastSeen })
        .eq('id', server!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated?.last_seen).toBe(lastSeen);
    });
  });

  describe('Server Queries', () => {
    it('should fetch all servers', async () => {
      const supabase = getTestSupabase();

      // Create multiple servers
      await supabase.from('servers').insert([
        createTestServer({ hostname: 'server-1' }),
        createTestServer({ hostname: 'server-2' }),
      ]);

      const { data: servers, error } = await supabase
        .from('servers')
        .select('*')
        .order('created_at', { ascending: false });

      expect(error).toBeNull();
      expect(servers).toBeDefined();
      expect(servers!.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter servers by connection status', async () => {
      const supabase = getTestSupabase();

      await supabase.from('servers').insert([
        createTestServer({ connection_status: 'online' }),
        createTestServer({ connection_status: 'offline' }),
      ]);

      const { data: onlineServers, error } = await supabase
        .from('servers')
        .select('*')
        .eq('connection_status', 'online');

      expect(error).toBeNull();
      expect(onlineServers).toBeDefined();
      expect(onlineServers!.every((s) => s.connection_status === 'online')).toBe(true);
    });

    it('should search servers by hostname', async () => {
      const supabase = getTestSupabase();
      const uniqueHostname = `search-test-${Date.now()}`;

      await supabase
        .from('servers')
        .insert(createTestServer({ hostname: uniqueHostname }));

      const { data: servers, error } = await supabase
        .from('servers')
        .select('*')
        .ilike('hostname', `%${uniqueHostname}%`);

      expect(error).toBeNull();
      expect(servers).toBeDefined();
      expect(servers!.length).toBeGreaterThan(0);
      expect(servers![0].hostname).toBe(uniqueHostname);
    });

    it('should search servers by IP address', async () => {
      const supabase = getTestSupabase();
      const uniqueIP = generateRandomIP();

      await supabase
        .from('servers')
        .insert(createTestServer({ ip_address: uniqueIP }));

      const { data: servers, error } = await supabase
        .from('servers')
        .select('*')
        .eq('ip_address', uniqueIP);

      expect(error).toBeNull();
      expect(servers).toBeDefined();
      expect(servers!.length).toBeGreaterThan(0);
      expect(servers![0].ip_address).toBe(uniqueIP);
    });
  });

  describe('Server Firmware and BIOS', () => {
    it('should update firmware version', async () => {
      const supabase = getTestSupabase();

      const { data: server } = await supabase
        .from('servers')
        .insert(createTestServer())
        .select()
        .single();

      const { data: updated, error } = await supabase
        .from('servers')
        .update({
          idrac_firmware: '5.10.00.00',
          bios_version: '2.15.2',
        })
        .eq('id', server!.id)
        .select()
        .single();

      expect(error).toBeNull();
      expect(updated?.idrac_firmware).toBe('5.10.00.00');
      expect(updated?.bios_version).toBe('2.15.2');
    });
  });

  describe('Server vCenter Integration', () => {
    it('should link server to vCenter host', async () => {
      const supabase = getTestSupabase();

      // Create vCenter host
      const { data: vcenterHost } = await supabase
        .from('vcenter_hosts')
        .insert({
          name: 'test-esxi-host',
          serial_number: generateServiceTag(),
          esxi_version: '7.0.3',
          status: 'connected',
        })
        .select()
        .single();

      // Create server and link to vCenter host
      const { data: server } = await supabase
        .from('servers')
        .insert(createTestServer({ vcenter_host_id: vcenterHost!.id }))
        .select()
        .single();

      expect(server?.vcenter_host_id).toBe(vcenterHost!.id);

      // Fetch server with vCenter host data
      const { data: serverWithHost, error } = await supabase
        .from('servers')
        .select('*, vcenter_hosts(*)')
        .eq('id', server!.id)
        .single();

      expect(error).toBeNull();
      expect((serverWithHost as any).vcenter_hosts).toBeDefined();
      expect((serverWithHost as any).vcenter_hosts.name).toBe('test-esxi-host');
    });
  });
});
