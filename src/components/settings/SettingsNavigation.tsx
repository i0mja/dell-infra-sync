import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export interface SettingsNavItem {
  id: string;
  name: string;
  icon: LucideIcon;
  subsections?: Array<{
    id: string;
    name: string;
  }>;
}

interface SettingsNavigationProps {
  items: SettingsNavItem[];
  activeTab: string;
  activeSection?: string;
  onNavigate: (tabId: string, sectionId?: string) => void;
}

export function SettingsNavigation({
  items,
  activeTab,
  activeSection,
  onNavigate,
}: SettingsNavigationProps) {
  return (
    <aside className="w-64 border-r bg-card flex-shrink-0">
      <ScrollArea className="h-screen">
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Settings</h2>
          <nav className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              
              return (
                <div key={item.id}>
                  <button
                    onClick={() => onNavigate(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.name}</span>
                  </button>
                  
                  {isActive && item.subsections && item.subsections.length > 0 && (
                    <div className="ml-7 mt-1 space-y-1">
                      {item.subsections.map((subsection) => (
                        <button
                          key={subsection.id}
                          onClick={() => onNavigate(item.id, subsection.id)}
                          className={cn(
                            "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors",
                            activeSection === subsection.id
                              ? "bg-primary/5 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {subsection.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      </ScrollArea>
    </aside>
  );
}
