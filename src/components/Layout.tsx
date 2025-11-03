import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Server, Database, Briefcase, Activity, LogOut, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

const Layout = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate("/auth");
    }
  }, [user, navigate]);

  if (!user) {
    return null;
  }

  const navigation = [
    { name: "Dashboard", href: "/", icon: Activity },
    { name: "Servers", href: "/servers", icon: Server },
    { name: "vCenter", href: "/vcenter", icon: Database },
    { name: "Jobs", href: "/jobs", icon: Briefcase },
  ];

  const NavLinks = () => (
    <>
      {navigation.map((item) => {
        const isActive = location.pathname === item.href;
        return (
          <Button
            key={item.name}
            variant={isActive ? "secondary" : "ghost"}
            className={cn(
              "w-full justify-start",
              isActive && "bg-secondary"
            )}
            onClick={() => {
              navigate(item.href);
              setMobileOpen(false);
            }}
          >
            <item.icon className="mr-2 h-4 w-4" />
            {item.name}
          </Button>
        );
      })}
    </>
  );

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 border-r bg-card md:block">
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center border-b px-6">
            <Server className="h-6 w-6 text-primary mr-2" />
            <span className="text-lg font-semibold">Server Manager</span>
          </div>
          <nav className="flex-1 space-y-1 p-4">
            <NavLinks />
          </nav>
          <div className="border-t p-4">
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
        <header className="flex h-16 items-center border-b bg-card px-4 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <div className="flex h-full flex-col">
                <div className="flex h-16 items-center border-b px-6">
                  <Server className="h-6 w-6 text-primary mr-2" />
                  <span className="text-lg font-semibold">Server Manager</span>
                </div>
                <nav className="flex-1 space-y-1 p-4">
                  <NavLinks />
                </nav>
                <div className="border-t p-4">
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
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
