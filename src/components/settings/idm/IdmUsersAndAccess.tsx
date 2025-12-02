import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Shield } from 'lucide-react';
import { IdmUserManager } from './IdmUserManager';
import { IdmRoleMappings } from './IdmRoleMappings';

export function IdmUsersAndAccess() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Managed Users
          </TabsTrigger>
          <TabsTrigger value="mappings" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Group Mappings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <IdmUserManager />
        </TabsContent>

        <TabsContent value="mappings" className="mt-4">
          <IdmRoleMappings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
