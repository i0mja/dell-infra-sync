import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Server, Database, Activity, LogOut, Menu, Settings, LayoutDashboard, ChevronRight, Calendar, FileBarChart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSearchParams } from "react-router-dom";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";
import { SearchTrigger } from "@/components/search/SearchTrigger";
import { getSettingsNavigation } from "@/config/settings-tabs";
import { getReportsNavigation } from "@/config/reports-navigation";
import { useJobExecutorInit } from "@/hooks/useJobExecutorInit";
import { GlobalSyncIndicator } from "@/components/GlobalSyncIndicator";

const Layout = () => {
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  
  // Initialize Job Executor URL from database on app load
  useJobExecutorInit();

  useEffect(() => {
    setSettingsOpen(location.pathname === '/settings');
    setReportsOpen(location.pathname.startsWith('/reports'));
  }, [location.pathname]);

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 p-8 rounded-lg bg-card border">
          <Server className="h-12 w-12 text-primary animate-pulse" />
          <p className="text-foreground font-medium">Loading Server Manager...</p>
          <p className="text-sm text-muted-foreground">Connecting to backend...</p>
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
  const reportsNavigation = getReportsNavigation();
  
  const isReportItemActive = (href: string) => {
    const targetCategory = new URLSearchParams(href.split('?')[1] || '').get('category');
    const currentCategory = searchParams.get('category');
    
    // For update report detail pages, highlight "Updates"
    if (location.pathname.startsWith('/reports/updates')) {
      return targetCategory === 'updates';
    }
    
    // "All Reports" is active when on /reports without category param
    if (href === '/reports' && !targetCategory) {
      return location.pathname === '/reports' && !currentCategory;
    }
    
    // Category match when on /reports page
    if (targetCategory && location.pathname === '/reports') {
      return currentCategory === targetCategory;
    }
    
    return false;
  };

  const activeTab = searchParams.get('tab') || 'general';

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
      
      {/* Reports Dropdown - Plain conditional rendering */}
      <div>
        <Button
          variant={location.pathname.startsWith('/reports') ? "secondary" : "ghost"}
          className={cn(
            "w-full justify-start transition-all duration-200",
            location.pathname.startsWith('/reports') && "bg-secondary"
          )}
          onClick={() => setReportsOpen(prev => !prev)}
        >
          <FileBarChart className="mr-2 h-4 w-4" />
          <span className="flex-1 text-left">Reports</span>
          <ChevronRight className={cn(
            "h-4 w-4 transition-transform duration-300 ease-in-out",
            reportsOpen && "rotate-90"
          )} />
        </Button>
        
        {reportsOpen && (
          <div className="space-y-0.5 mt-1">
            {reportsNavigation.map((item) => {
              const isActive = isReportItemActive(item.href);
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
          </div>
        )}
      </div>
      
      {/* Settings Dropdown - Plain conditional rendering */}
      <div>
        <Button
          variant={location.pathname === '/settings' ? "secondary" : "ghost"}
          className={cn(
            "w-full justify-start transition-all duration-200",
            location.pathname === '/settings' && "bg-secondary"
          )}
          onClick={() => setSettingsOpen(prev => !prev)}
        >
          <Settings className="mr-2 h-4 w-4" />
          <span className="flex-1 text-left">Settings</span>
          <ChevronRight className={cn(
            "h-4 w-4 transition-transform duration-300 ease-in-out",
            settingsOpen && "rotate-90"
          )} />
        </Button>
        
        {settingsOpen && (
          <div className="space-y-0.5 mt-1">
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
          </div>
        )}
      </div>
    </>
  );

  const edgeToEdgeRoutes = ["/", "/servers", "/vcenter", "/activity", "/maintenance-planner", "/reports", "/settings"];
  const useEdgeToEdgeLayout = edgeToEdgeRoutes.some((path) =>
    location.pathname.startsWith(path)
  );

  const containerClasses = cn(
    "w-full",
    useEdgeToEdgeLayout
      ? "max-w-full px-0 pb-0 pt-0 h-full"
      : "mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8"
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-52 border-r bg-card md:block">
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center justify-between border-b px-4 flex-shrink-0">
            <div className="flex items-center">
              <Server className="h-5 w-5 text-primary mr-2" />
              <span className="text-sm font-semibold">Server Manager</span>
            </div>
            <div className="flex items-center gap-1">
              <SearchTrigger compact />
              <NotificationCenter />
            </div>
          </div>
          <ScrollArea className="flex-1">
            <nav className="space-y-0.5 p-3">
              <NavLinks />
            </nav>
          </ScrollArea>
          <div className="border-t p-3 flex-shrink-0">
            <div className="mb-1.5 px-2">
              <p className="text-xs font-medium truncate">{user.email}</p>
              <p className="text-xs text-muted-foreground">Administrator</p>
            </div>
            <Button variant="ghost" size="sm" className="w-full justify-start h-8" onClick={signOut}>
              <LogOut className="mr-2 h-3.5 w-3.5" />
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
              <SheetContent side="left" className="w-52 p-0">
                <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
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
          <div className="flex items-center gap-2">
            <SearchTrigger compact />
            <NotificationCenter />
          </div>
        </header>

        {/* Main Content */}
        <main className={cn(
          "flex-1 bg-background",
          useEdgeToEdgeLayout ? "overflow-hidden" : "overflow-auto"
        )}>
          <div className={containerClasses}>
            <div className={cn(
              "animate-in fade-in duration-300",
              useEdgeToEdgeLayout && "h-full"
            )}>
              <Outlet key={location.pathname} />
            </div>
          </div>
        </main>
      </div>
      
      {/* Global sync indicator - visible on all pages except dashboard */}
      <GlobalSyncIndicator />
    </div>
  );
};

export default Layout;
