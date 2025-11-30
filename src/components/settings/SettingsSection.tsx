import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface SettingsSectionProps {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
}

export function SettingsSection({
  title,
  description,
  icon: Icon,
  children,
}: SettingsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="p-2 rounded-md bg-muted/50">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">
              {description}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}
