import { LayoutDashboard, Activity, ListTodo, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ServerSidebarTabsProps {
  activeTab: "dashboard" | "events" | "tasks" | "settings";
  onTabChange: (tab: "dashboard" | "events" | "tasks" | "settings") => void;
}

const tabs = [
  { id: "dashboard" as const, icon: LayoutDashboard, label: "Dashboard" },
  { id: "events" as const, icon: Activity, label: "Events" },
  { id: "tasks" as const, icon: ListTodo, label: "Tasks" },
  { id: "settings" as const, icon: Settings, label: "Settings" },
];

export function ServerSidebarTabs({ activeTab, onTabChange }: ServerSidebarTabsProps) {
  return (
    <div className="flex items-center justify-around border-t border-border bg-muted/30 px-2 py-1.5">
      <TooltipProvider delayDuration={300}>
        {tabs.map((tab) => (
          <Tooltip key={tab.id}>
            <TooltipTrigger asChild>
              <Button
                variant={activeTab === tab.id ? "secondary" : "ghost"}
                size="sm"
                className={`h-8 w-8 p-0 ${
                  activeTab === tab.id 
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onTabChange(tab.id)}
              >
                <tab.icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {tab.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </TooltipProvider>
    </div>
  );
}
