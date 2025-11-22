import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Server, Database, Activity, LogOut, Menu, Settings, LayoutDashboard, ChevronRight, Palette, Mail, MessageSquare, Bell, Shield, Network, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSearchParams } from "react-router-dom";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { getSettingsNavigation } from "@/config/settings-tabs";

const Layout = () => {
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setSettingsOpen(location.pathname === '/settings');
  }, [location.pathname]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Server className="h-12 w-12 text-primary animate-pulse" />
          <p className="text-muted-foreground">Loading Server Manager...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Servers", href: "/servers", icon: Server },
    { name: "vCenter", href: "/vcenter", icon: Database },
    { name: "Maintenance Planner", href: "/maintenance-planner", icon: Calendar },
    { name: "Activity Monitor", href: "/activity", icon: Activity },
  ];

  const settingsNavigation = getSettingsNavigation();

  const activeTab = searchParams.get('tab') || 'appearance';

  const NavLinks = () => (
    <>
      {navigation.map((item) => {
        const isActive = location.pathname === item.href;
        return (
          <Button
            key={item.name}
            variant={isActive ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start transition-all duration-200 truncate",
              isActive && "bg-secondary"
            )}
            onClick={() => {
              navigate(item.href);
              setMobileOpen(false);
            }}
            title={item.name}
          >
            <item.icon className="mr-2 h-4 w-4 flex-shrink-0" />
            <span className="truncate">{item.name}</span>
          </Button>
        );
      })}
      
      {/* Settings Dropdown */}
      <Collapsible open={settingsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant={location.pathname === '/settings' ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start transition-all duration-200",
              location.pathname === '/settings' && "bg-secondary"
            )}
            onClick={() => {
              if (location.pathname !== '/settings') {
                navigate('/settings?tab=appearance');
              }
            }}
          >
            <Settings className="mr-2 h-4 w-4" />
            <span className="flex-1 text-left">Settings</span>
            <ChevronRight className={cn(
              "h-4 w-4 transition-transform duration-300 ease-in-out",
              settingsOpen && "rotate-90"
            )} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1 mt-1">
          {settingsNavigation.map((item) => {
            const isActive = location.pathname === '/settings' && 
                            (item.href.includes(`tab=${activeTab}`) || 
                             (!activeTab && item.href.includes('tab=appearance')));
            return (
              <Button
                key={item.name}
                variant={isActive ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start pl-10 text-sm transition-all duration-200 truncate",
                  isActive && "bg-muted text-foreground font-medium"
                )}
                onClick={() => {
                  navigate(item.href);
                  setMobileOpen(false);
                }}
                title={item.name}
              >
                <item.icon className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{item.name}</span>
              </Button>
            );
          })}
        </CollapsibleContent>
      </Collapsible>
    </>
  );

  const edgeToEdgeRoutes = ["/servers", "/vcenter", "/activity"];
  const useEdgeToEdgeLayout = edgeToEdgeRoutes.some((path) =>
    location.pathname.startsWith(path)
  );

  const containerClasses = cn(
    "w-full",
    useEdgeToEdgeLayout
      ? "max-w-full px-0 pb-6 pt-0"
      : "mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8"
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 border-r bg-card md:block">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b px-6 flex-shrink-0">
            <div className="flex items-center">
              <Server className="h-6 w-6 text-primary mr-2" />
              <span className="text-lg font-semibold">Server Manager</span>
            </div>
            <NotificationCenter />
          </div>
          <ScrollArea className="flex-1">
            <nav className="space-y-1 p-4">
              <NavLinks />
            </nav>
          </ScrollArea>
          <div className="border-t p-4 flex-shrink-0">
            <div className="mb-2 px-2">
              <p className="text-sm font-medium">{user.email}</p>
              <p className="text-xs text-muted-foreground">Administrator</p>
            </div>
            <Button variant="ghost" className="w-full justify-start" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="flex flex-col flex-1">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:hidden">
          <div className="flex items-center">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex h-full flex-col">
                  <div className="flex h-16 items-center border-b px-6 flex-shrink-0">
                    <Server className="h-6 w-6 text-primary mr-2" />
                    <span className="text-lg font-semibold">Server Manager</span>
                  </div>
                  <ScrollArea className="flex-1">
                    <nav className="space-y-1 p-4">
                      <NavLinks />
                    </nav>
                  </ScrollArea>
                  <div className="border-t p-4 flex-shrink-0">
                    <div className="mb-2 px-2">
                      <p className="text-sm font-medium">{user.email}</p>
                      <p className="text-xs text-muted-foreground">Administrator</p>
                    </div>
                    <Button variant="ghost" className="w-full justify-start" onClick={signOut}>
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <div className="ml-4 flex items-center">
              <Server className="h-6 w-6 text-primary mr-2" />
              <span className="text-lg font-semibold">Server Manager</span>
            </div>
          </div>
          <NotificationCenter />
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-background">
          <div className={containerClasses}>
            <div className="animate-in fade-in duration-300">
              <Outlet key={location.pathname} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
