import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSshKeys, SshKey, SshKeyDeployment } from '@/hooks/useSshKeys';
import { 
  SshKeyTable, 
  SshKeyGenerateDialog, 
  SshKeyDetailsDialog, 
  SshKeyRevokeDialog, 
  SshKeyDeployDialog, 
  SshKeyRotateWizard,
  SshKeyMigrationDialog,
  SshKeyExpirationAlerts,
  SshKeyUsageStats
} from '@/components/settings/ssh';
import { Plus, ArrowRightLeft, Key, Loader2 } from 'lucide-react';

export function SshKeysTabPanel() {
  const { 
    sshKeys, 
    isLoading, 
    refetch, 
    generateKey, 
    isGenerating, 
    revokeKey, 
    isRevoking, 
    deleteKey, 
    fetchDeployments, 
    removeFromTargets 
  } = useSshKeys();

  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [selectedSshKey, setSelectedSshKey] = useState<SshKey | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [showRotateWizard, setShowRotateWizard] = useState(false);
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [selectedKeyDeployments, setSelectedKeyDeployments] = useState<SshKeyDeployment[]>([]);

  const activeKeys = sshKeys.filter(k => k.status === 'active').length;
  const expiredKeys = sshKeys.filter(k => k.status === 'expired').length;

  return (
    <Card>
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">SSH Key Inventory</h3>
            <p className="text-sm text-muted-foreground">
              Centralized SSH key management for ZFS targets and replication
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowMigrationDialog(true)}>
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Migrate Keys
            </Button>
            <Button onClick={() => setShowGenerateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Generate Key
            </Button>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 text-sm bg-muted/30 rounded-lg p-3">
          <span className="text-muted-foreground">Total: <span className="font-medium text-foreground">{sshKeys.length}</span></span>
          <span className="text-muted-foreground">Active: <span className="font-medium text-green-600">{activeKeys}</span></span>
          <span className="text-muted-foreground">Expired: <span className="font-medium text-red-600">{expiredKeys}</span></span>
        </div>

        {/* Expiration Alerts */}
        <SshKeyExpirationAlerts
          keys={sshKeys}
          onRotate={async (key) => {
            setSelectedSshKey(key as SshKey);
            const deployments = await fetchDeployments(key.id);
            setSelectedKeyDeployments(deployments);
            setShowRotateWizard(true);
          }}
          onRevoke={(key) => {
            setSelectedSshKey(key as SshKey);
            setShowRevokeDialog(true);
          }}
        />

        {/* Usage Stats */}
        <SshKeyUsageStats keys={sshKeys} />

        {/* SSH Key Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : sshKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Key className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              No SSH keys configured. Generate your first key to get started.
            </p>
          </div>
        ) : (
          <SshKeyTable
            keys={sshKeys}
            isLoading={isLoading}
            onViewDetails={(key) => {
              setSelectedSshKey(key);
              setShowDetailsDialog(true);
            }}
            onRevoke={(key) => {
              setSelectedSshKey(key);
              setShowRevokeDialog(true);
            }}
            onDelete={async (key) => {
              if (confirm(`Delete SSH key "${key.name}"? This cannot be undone.`)) {
                await deleteKey(key.id);
              }
            }}
            onDeploy={(key) => {
              setSelectedSshKey(key);
              setShowDeployDialog(true);
            }}
            onRotate={async (key) => {
              setSelectedSshKey(key);
              const deployments = await fetchDeployments(key.id);
              setSelectedKeyDeployments(deployments);
              setShowRotateWizard(true);
            }}
          />
        )}

        {/* Dialogs */}
        <SshKeyGenerateDialog
          open={showGenerateDialog}
          onOpenChange={setShowGenerateDialog}
          onGenerate={generateKey}
          isGenerating={isGenerating}
        />

        <SshKeyDetailsDialog
          open={showDetailsDialog}
          onOpenChange={setShowDetailsDialog}
          sshKey={selectedSshKey}
          fetchDeployments={fetchDeployments}
        />

        <SshKeyRevokeDialog
          open={showRevokeDialog}
          onOpenChange={setShowRevokeDialog}
          sshKey={selectedSshKey}
          onRevoke={revokeKey}
          isRevoking={isRevoking}
          fetchDeployments={fetchDeployments}
          removeFromTargets={removeFromTargets}
        />

        <SshKeyDeployDialog
          open={showDeployDialog}
          onOpenChange={setShowDeployDialog}
          sshKey={selectedSshKey}
          onDeployComplete={() => refetch()}
        />

        <SshKeyRotateWizard
          open={showRotateWizard}
          onOpenChange={setShowRotateWizard}
          oldKey={selectedSshKey}
          deployments={selectedKeyDeployments}
          onComplete={() => refetch()}
        />

        <SshKeyMigrationDialog
          open={showMigrationDialog}
          onOpenChange={setShowMigrationDialog}
          onComplete={() => refetch()}
        />
      </CardContent>
    </Card>
  );
}
