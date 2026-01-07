# ZFS Agent

A FastAPI-based REST API service for managing ZFS appliances in the Dell Infra Sync DR system.

## Features

- **Pool & Dataset Management**: List pools, datasets, and their properties
- **Snapshot Operations**: Create, list, and prune snapshots
- **Replication**: Syncoid-based replication with status tracking
- **NFS Exports**: Manage NFS exports for vCenter datastores
- **Health Monitoring**: Heartbeat and status reporting to Supabase
- **Job Tracking**: Local job queue with logs

## Installation

```bash
# On the ZFS appliance (as root)
cd zfs-agent
chmod +x install_zfs_agent.sh
./install_zfs_agent.sh
```

## Configuration

Edit `/etc/zfs-agent/agent.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
ZFS_DEFAULT_POOL=tank
HEARTBEAT_INTERVAL=60
LOG_LEVEL=INFO
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/health` | GET | Health check |
| `/v1/capabilities` | GET | Agent capabilities |
| `/v1/pools` | GET | List ZFS pools |
| `/v1/datasets` | GET | List datasets |
| `/v1/snapshots` | GET | List snapshots |
| `/v1/snapshots/{dataset}/create` | POST | Create snapshot |
| `/v1/snapshots/{dataset}@{name}` | DELETE | Delete snapshot |
| `/v1/snapshots/prune` | POST | Prune old snapshots |
| `/v1/replication/pairs` | GET | List replication pairs |
| `/v1/replication/pairs/{id}/run` | POST | Run replication |
| `/v1/replication/pairs/{id}/repair` | POST | Repair replication |
| `/v1/exports` | GET | List NFS exports |
| `/v1/exports` | POST | Create NFS export |
| `/v1/jobs` | GET | List jobs |

## Service Management

```bash
# Check status
systemctl status zfs-agent

# View logs
journalctl -u zfs-agent -f

# Restart
systemctl restart zfs-agent
```

## Security

- Runs as `zfsagent` user with limited sudo for ZFS commands
- HTTPS with self-signed certificate by default
- JWT authentication (optional)
- Binds to internal network only
