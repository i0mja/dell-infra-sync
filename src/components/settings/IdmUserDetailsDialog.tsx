import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { format } from 'date-fns';

interface IdmUserDetailsDialogProps {
  user: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IdmUserDetailsDialog({ user, open, onOpenChange }: IdmUserDetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>User Details: {user.full_name || user.email}</DialogTitle>
          <DialogDescription>
            Detailed information for IDM user
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Profile Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Profile Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Full Name</Label>
                <p className="text-sm mt-1">{user.full_name || 'N/A'}</p>
              </div>
              <div>
                <Label>Email</Label>
                <p className="text-sm font-mono mt-1">{user.email}</p>
              </div>
              <div>
                <Label>Department</Label>
                <p className="text-sm mt-1">{user.idm_department || 'N/A'}</p>
              </div>
              <div>
                <Label>Title</Label>
                <p className="text-sm mt-1">{user.idm_title || 'N/A'}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* IDM Attributes */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">IDM Attributes</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>IDM UID</Label>
                <p className="text-sm font-mono mt-1">{user.idm_uid || 'N/A'}</p>
              </div>
              <div>
                <Label>IDM Source</Label>
                <p className="text-sm mt-1">{user.idm_source || 'N/A'}</p>
              </div>
            </div>

            {user.idm_user_dn && (
              <div>
                <Label>User DN</Label>
                <p className="text-sm font-mono mt-1 break-all">{user.idm_user_dn}</p>
              </div>
            )}

            {user.idm_mail && (
              <div>
                <Label>IDM Email</Label>
                <p className="text-sm font-mono mt-1">{user.idm_mail}</p>
              </div>
            )}

            {user.idm_groups && (
              <div>
                <Label>IDM Groups</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(user.idm_groups as string[]).map((group, idx) => (
                    <Badge key={idx} variant="secondary">{group}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Status & Sync */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Status & Synchronization</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <div className="mt-1">
                  {user.idm_disabled ? (
                    <Badge variant="destructive">Disabled</Badge>
                  ) : (
                    <Badge variant="default">Active</Badge>
                  )}
                </div>
              </div>
              <div>
                <Label>Last IDM Sync</Label>
                <p className="text-sm mt-1">
                  {user.last_idm_sync ? format(new Date(user.last_idm_sync), 'PPpp') : 'Never synced'}
                </p>
              </div>
              <div>
                <Label>Account Created</Label>
                <p className="text-sm mt-1">
                  {format(new Date(user.created_at), 'PPpp')}
                </p>
              </div>
              <div>
                <Label>Last Updated</Label>
                <p className="text-sm mt-1">
                  {format(new Date(user.updated_at), 'PPpp')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
