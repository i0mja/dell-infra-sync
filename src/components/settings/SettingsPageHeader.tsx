import { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SettingsPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: {
    label: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
  };
  actions?: React.ReactNode;
}

export function SettingsPageHeader({
  icon: Icon,
  title,
  description,
  badge,
  actions,
}: SettingsPageHeaderProps) {
  return (
    <div className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="px-8 py-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                {badge && (
                  <Badge variant={badge.variant || "secondary"}>
                    {badge.label}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
