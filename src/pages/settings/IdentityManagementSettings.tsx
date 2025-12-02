import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'react-router-dom';
import { Activity, Link, Users, Shield } from 'lucide-react';
import {
  IdmOverview,
  IdmConnectionTab,
  IdmUsersAndAccess,
  IdmSecurityTab,
} from '@/components/settings/idm';

export function IdentityManagementSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = searchParams.get('section') || 'overview';

  const handleTabChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('section', value);
    setSearchParams(newParams);
  };

  return (
    <Tabs value={section} onValueChange={handleTabChange} className="space-y-6">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="overview" className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="hidden sm:inline">Overview</span>
        </TabsTrigger>
        <TabsTrigger value="connection" className="flex items-center gap-2">
          <Link className="h-4 w-4" />
          <span className="hidden sm:inline">Connection</span>
        </TabsTrigger>
        <TabsTrigger value="users-access" className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span className="hidden sm:inline">Users & Access</span>
        </TabsTrigger>
        <TabsTrigger value="security" className="flex items-center gap-2">
          <Shield className="h-4 w-4" />
          <span className="hidden sm:inline">Security</span>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <IdmOverview />
      </TabsContent>

      <TabsContent value="connection">
        <IdmConnectionTab />
      </TabsContent>

      <TabsContent value="users-access">
        <IdmUsersAndAccess />
      </TabsContent>

      <TabsContent value="security">
        <IdmSecurityTab />
      </TabsContent>
    </Tabs>
  );
}
