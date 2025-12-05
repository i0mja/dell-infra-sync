import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, Shield, UserCheck } from 'lucide-react';
import { IdmUserManager } from './IdmUserManager';
import { IdmRoleMappings } from './IdmRoleMappings';
import { SignedInUsersManager } from './SignedInUsersManager';

export function IdmUsersAndAccess() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="signed-in" className="space-y-4">
        <TabsList>
          <TabsTrigger value="signed-in" className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Signed-In Users
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Pre-Authorized
          </TabsTrigger>
          <TabsTrigger value="mappings" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Group Mappings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="signed-in" className="mt-4">
          <SignedInUsersManager />
        </TabsContent>

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
