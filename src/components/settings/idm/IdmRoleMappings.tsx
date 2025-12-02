import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIdmGroupMappings } from '@/hooks/useIdmGroupMappings';
import { Plus, Trash2, Loader2, Search, Users, ChevronDown, ChevronRight, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';

interface GroupSearchResult {
  dn: string;
  cn: string;
  description: string | null;
  member_count: number;
  members: string[];
}

export function IdmRoleMappings() {
  const { mappings, loading, createMapping, updateMapping, deleteMapping } = useIdmGroupMappings();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [mappingForm, setMappingForm] = useState({
    idm_group_dn: '',
    idm_group_name: '',
    app_role: 'viewer' as 'admin' | 'operator' | 'viewer',
    priority: 100,
    is_active: true,
    description: '',
  });

  // Group search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<GroupSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<GroupSearchResult | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroupExpand = (dn: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(dn)) {
        next.delete(dn);
      } else {
        next.add(dn);
      }
      return next;
    });
  };

  const handleSearchGroups = async () => {
    if (!searchTerm.trim()) {
      toast({
        title: "Search term required",
        description: "Please enter a search term to find groups",
        variant: "destructive",
      });
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setSelectedGroup(null);
    setExpandedGroups(new Set());

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create job for group search
      const { data: job, error: jobError } = await supabase
        .from('jobs')
        .insert({
          job_type: 'idm_search_groups',
          created_by: user.id,
          status: 'pending',
          details: {
            search_term: searchTerm,
            max_results: 100,
          },
        })
        .select()
        .single();

      if (jobError) throw jobError;

      // Poll for job completion
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout
      
      const pollInterval = setInterval(async () => {
        attempts++;
        
        const { data: updatedJob, error: pollError } = await supabase
          .from('jobs')
          .select('status, details')
          .eq('id', job.id)
          .single();

        if (pollError) {
          clearInterval(pollInterval);
          setIsSearching(false);
          toast({
            title: "Search failed",
            description: "Failed to retrieve search results",
            variant: "destructive",
          });
          return;
        }

        if (updatedJob.status === 'completed') {
          clearInterval(pollInterval);
          setIsSearching(false);
          const details = updatedJob.details as any;
          const groups = details?.groups || [];
          setSearchResults(groups);
          
          if (groups.length === 0) {
            toast({
              title: "No groups found",
              description: `No groups matching "${searchTerm}" were found`,
            });
          }
        } else if (updatedJob.status === 'failed') {
          clearInterval(pollInterval);
          setIsSearching(false);
          const details = updatedJob.details as any;
          toast({
            title: "Search failed",
            description: details?.error || "Group search failed",
            variant: "destructive",
          });
        } else if (attempts >= maxAttempts) {
          clearInterval(pollInterval);
          setIsSearching(false);
          toast({
            title: "Search timeout",
            description: "Group search is taking too long. Please try again.",
            variant: "destructive",
          });
        }
      }, 1000);
    } catch (error: any) {
      setIsSearching(false);
      toast({
        title: "Error",
        description: error.message || "Failed to initiate group search",
        variant: "destructive",
      });
    }
  };

  const handleSelectGroup = (group: GroupSearchResult) => {
    setSelectedGroup(group);
    setMappingForm({
      ...mappingForm,
      idm_group_dn: group.dn,
      idm_group_name: group.cn,
    });
  };

  const handleCreateMapping = async () => {
    await createMapping(mappingForm);
    setMappingForm({
      idm_group_dn: '',
      idm_group_name: '',
      app_role: 'viewer',
      priority: 100,
      is_active: true,
      description: '',
    });
    setSearchTerm('');
    setSearchResults([]);
    setSelectedGroup(null);
    setExpandedGroups(new Set());
    setShowDialog(false);
  };

  const resetDialog = () => {
    setMappingForm({
      idm_group_dn: '',
      idm_group_name: '',
      app_role: 'viewer',
      priority: 100,
      is_active: true,
      description: '',
    });
    setSearchTerm('');
    setSearchResults([]);
    setSelectedGroup(null);
    setExpandedGroups(new Set());
    setShowDialog(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Group-to-Role Mappings</CardTitle>
              <CardDescription>Map FreeIPA groups to application roles</CardDescription>
            </div>
            <Dialog open={showDialog} onOpenChange={(open) => !open && resetDialog()}>
              <DialogTrigger asChild>
                <Button onClick={() => setShowDialog(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Mapping
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create Group Mapping</DialogTitle>
                  <DialogDescription>Search for a FreeIPA group and map it to an application role</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {/* Group Search */}
                  <Card className="border-dashed">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4" />
                        Search FreeIPA Groups
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Enter group name to search..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchGroups()}
                          disabled={isSearching}
                        />
                        <Button 
                          onClick={handleSearchGroups} 
                          disabled={isSearching || !searchTerm.trim()}
                        >
                          {isSearching ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Search className="h-4 w-4" />
                          )}
                        </Button>
                      </div>

                      {isSearching && (
                        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Searching groups...
                        </div>
                      )}

                      {!isSearching && searchResults.length > 0 && (
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Found {searchResults.length} group(s)
                          </Label>
                          <ScrollArea className="h-64 border rounded-md">
                            <div className="p-1">
                              {searchResults.map((group) => {
                                const isExpanded = expandedGroups.has(group.dn);
                                const isSelected = selectedGroup?.dn === group.dn;
                                
                                return (
                                  <Collapsible 
                                    key={group.dn}
                                    open={isExpanded}
                                    onOpenChange={() => toggleGroupExpand(group.dn)}
                                  >
                                    <div 
                                      className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${
                                        isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                                      }`}
                                      onClick={() => handleSelectGroup(group)}
                                    >
                                      <div className={`h-4 w-4 rounded-full border-2 flex-shrink-0 ${
                                        isSelected 
                                          ? 'bg-primary border-primary' 
                                          : 'border-muted-foreground'
                                      }`} />
                                      
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium truncate">{group.cn}</span>
                                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                                            <User className="h-3 w-3 mr-1" />
                                            {group.member_count}
                                          </Badge>
                                        </div>
                                        {group.description && (
                                          <p className="text-xs text-muted-foreground truncate">
                                            {group.description}
                                          </p>
                                        )}
                                      </div>
                                      
                                      {group.member_count > 0 && (
                                        <CollapsibleTrigger asChild>
                                          <Button 
                                            variant="ghost" 
                                            size="sm" 
                                            className="h-6 w-6 p-0"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              toggleGroupExpand(group.dn);
                                            }}
                                          >
                                            {isExpanded ? (
                                              <ChevronDown className="h-4 w-4" />
                                            ) : (
                                              <ChevronRight className="h-4 w-4" />
                                            )}
                                          </Button>
                                        </CollapsibleTrigger>
                                      )}
                                    </div>
                                    
                                    <CollapsibleContent>
                                      <div className="ml-8 mb-2 p-2 bg-muted/30 rounded-md">
                                        <div className="flex flex-wrap gap-1">
                                          {group.members.map((member, idx) => (
                                            <Badge 
                                              key={idx} 
                                              variant="outline" 
                                              className="text-xs font-normal"
                                            >
                                              <User className="h-3 w-3 mr-1" />
                                              {member}
                                            </Badge>
                                          ))}
                                          {group.member_count > group.members.length && (
                                            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                                              +{group.member_count - group.members.length} more
                                            </Badge>
                                          )}
                                          {group.members.length === 0 && group.member_count > 0 && (
                                            <span className="text-xs text-muted-foreground">
                                              {group.member_count} member(s)
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                );
                              })}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Group DN (read-only when selected from search) */}
                  <div className="space-y-2">
                    <Label>Group DN</Label>
                    <Input
                      placeholder="cn=admins,cn=groups,cn=accounts,dc=example,dc=com"
                      value={mappingForm.idm_group_dn}
                      onChange={(e) => setMappingForm({ ...mappingForm, idm_group_dn: e.target.value })}
                      readOnly={!!selectedGroup}
                      className={selectedGroup ? 'bg-muted' : ''}
                    />
                  </div>

                  {/* Group Name (read-only when selected from search) */}
                  <div className="space-y-2">
                    <Label>Group Name</Label>
                    <Input
                      placeholder="admins"
                      value={mappingForm.idm_group_name}
                      onChange={(e) => setMappingForm({ ...mappingForm, idm_group_name: e.target.value })}
                      readOnly={!!selectedGroup}
                      className={selectedGroup ? 'bg-muted' : ''}
                    />
                  </div>

                  {/* App Role */}
                  <div className="space-y-2">
                    <Label>App Role</Label>
                    <Select
                      value={mappingForm.app_role}
                      onValueChange={(value: any) => setMappingForm({ ...mappingForm, app_role: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="operator">Operator</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority */}
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Input
                      type="number"
                      value={mappingForm.priority}
                      onChange={(e) => setMappingForm({ ...mappingForm, priority: parseInt(e.target.value) })}
                    />
                    <p className="text-sm text-muted-foreground">Higher priority = evaluated first</p>
                  </div>

                  {/* Description */}
                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Input
                      value={mappingForm.description}
                      onChange={(e) => setMappingForm({ ...mappingForm, description: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={resetDialog}>Cancel</Button>
                  <Button onClick={handleCreateMapping}>Create Mapping</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group Name</TableHead>
                <TableHead>App Role</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No group mappings configured. Add a mapping to get started.
                  </TableCell>
                </TableRow>
              ) : (
                mappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">{mapping.idm_group_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{mapping.app_role}</Badge>
                    </TableCell>
                    <TableCell>{mapping.priority}</TableCell>
                    <TableCell>
                      {mapping.is_active ? (
                        <Badge variant="default">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateMapping(mapping.id, { is_active: !mapping.is_active })}
                        >
                          {mapping.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteMapping(mapping.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
