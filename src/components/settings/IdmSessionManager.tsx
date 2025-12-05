import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useIdmSessions } from '@/hooks/useIdmSessions';
import { Clock, Loader2, LogOut, RefreshCw, ShieldX, Trash2, User, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

export function IdmSessionManager() {
  const { 
    sessions, 
    loading, 
    showInactive,
    loadSessions, 
    toggleShowInactive,
    invalidateSession, 
    cleanupExpiredSessions, 
    cleanupInactiveSessions,
    purgeOldSessions 
  } = useIdmSessions();
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [invalidateReason, setInvalidateReason] = useState('');
  const [showInvalidateDialog, setShowInvalidateDialog] = useState(false);
  const [showPurgeDialog, setShowPurgeDialog] = useState(false);

  const activeCount = sessions.filter(s => s.is_active).length;
  const inactiveCount = sessions.filter(s => !s.is_active).length;
  const expiredCount = sessions.filter(s => !s.is_active && s.session_expires_at && new Date(s.session_expires_at) < new Date()).length;

  const handleInvalidate = async () => {
    if (selectedSession && invalidateReason) {
      await invalidateSession(selectedSession.id, invalidateReason);
      setShowInvalidateDialog(false);
      setInvalidateReason('');
      setSelectedSession(null);
    }
  };

  const handlePurge = async () => {
    await purgeOldSessions(7);
    setShowPurgeDialog(false);
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge variant="destructive">Admin</Badge>;
      case 'operator':
        return <Badge variant="default">Operator</Badge>;
      case 'viewer':
        return <Badge variant="secondary">Viewer</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  const getStatusBadge = (session: any) => {
    if (!session.is_active) {
      return <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>;
    }
    if (session.session_expires_at && new Date(session.session_expires_at) < new Date()) {
      return <Badge variant="destructive">Expired</Badge>;
    }
    return <Badge variant="default">Active</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Statistics */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Inactive Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">{inactiveCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Displayed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sessions.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Session Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>IDM Sessions</CardTitle>
              <CardDescription>Manage user sessions and force logouts</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="show-inactive"
                  checked={showInactive}
                  onCheckedChange={toggleShowInactive}
                />
                <Label htmlFor="show-inactive" className="text-sm">Show inactive</Label>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={loadSessions} disabled={loading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button variant="outline" size="sm" onClick={cleanupInactiveSessions}>
                  <Clock className="mr-2 h-4 w-4" />
                  Cleanup Inactive
                </Button>
                <Button variant="outline" size="sm" onClick={cleanupExpiredSessions}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Cleanup Expired
                </Button>
                <Dialog open={showPurgeDialog} onOpenChange={setShowPurgeDialog}>
                  <DialogTrigger asChild>
                    <Button variant="destructive" size="sm">
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Purge Old
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Purge Old Sessions</DialogTitle>
                      <DialogDescription>
                        This will permanently DELETE all inactive sessions older than 7 days. This action cannot be undone.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowPurgeDialog(false)}>
                        Cancel
                      </Button>
                      <Button variant="destructive" onClick={handlePurge}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Purge Sessions
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>IDM UID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last Activity</TableHead>
                <TableHead>IP Address</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    {showInactive ? 'No IDM sessions found' : 'No active IDM sessions found'}
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => (
                  <TableRow key={session.id} className={!session.is_active ? 'opacity-60' : ''}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{session.user_id?.substring(0, 8)}...</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{session.idm_uid}</TableCell>
                    <TableCell>{getRoleBadge(session.mapped_role)}</TableCell>
                    <TableCell className="text-sm">
                      {session.session_started_at ? format(new Date(session.session_started_at), 'MMM d, HH:mm') : 'N/A'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {session.session_expires_at ? format(new Date(session.session_expires_at), 'MMM d, HH:mm') : 'N/A'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {session.last_activity_at ? format(new Date(session.last_activity_at), 'MMM d, HH:mm') : 'N/A'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{session.ip_address || 'N/A'}</TableCell>
                    <TableCell>{getStatusBadge(session)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Dialog open={showInvalidateDialog && selectedSession?.id === session.id} onOpenChange={setShowInvalidateDialog}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedSession(session)}
                              disabled={!session.is_active}
                            >
                              <LogOut className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Invalidate Session</DialogTitle>
                              <DialogDescription>
                                Force logout user {session.idm_uid}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <Label>Reason for Invalidation</Label>
                                <Textarea
                                  placeholder="Enter reason (required)..."
                                  value={invalidateReason}
                                  onChange={(e) => setInvalidateReason(e.target.value)}
                                  rows={3}
                                />
                              </div>
                            </div>
                            <DialogFooter>
                              <Button
                                variant="destructive"
                                onClick={handleInvalidate}
                                disabled={!invalidateReason}
                              >
                                <ShieldX className="mr-2 h-4 w-4" />
                                Invalidate Session
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
