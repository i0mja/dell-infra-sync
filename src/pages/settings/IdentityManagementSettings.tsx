import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'react-router-dom';
import {
  IdmOverview,
  IdmConnectionSettings,
  IdmDirectorySettings,
  IdmRoleMappings,
  IdmSecurityPolicies,
  IdmBreakGlass,
  IdmUserManager,
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
      <TabsList className="grid w-full grid-cols-7">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="connection">Connection</TabsTrigger>
        <TabsTrigger value="user-manager">User Manager</TabsTrigger>
        <TabsTrigger value="directory">Directory</TabsTrigger>
        <TabsTrigger value="role-mappings">Role Mappings</TabsTrigger>
        <TabsTrigger value="security-policies">Security</TabsTrigger>
        <TabsTrigger value="break-glass">Break-Glass</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <IdmOverview />
      </TabsContent>

      <TabsContent value="connection">
        <IdmConnectionSettings />
      </TabsContent>

      <TabsContent value="user-manager">
        <IdmUserManager />
      </TabsContent>

      <TabsContent value="directory">
        <IdmDirectorySettings />
      </TabsContent>

      <TabsContent value="role-mappings">
        <IdmRoleMappings />
      </TabsContent>

      <TabsContent value="security-policies">
        <IdmSecurityPolicies />
      </TabsContent>

      <TabsContent value="break-glass">
        <IdmBreakGlass />
      </TabsContent>
    </Tabs>
  );
}