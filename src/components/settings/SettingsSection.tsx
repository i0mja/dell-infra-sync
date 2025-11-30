import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  children,
  defaultOpen = false,
  className,
}: SettingsSectionProps) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue={defaultOpen ? id : undefined}
      className={cn("w-full", className)}
    >
      <AccordionItem value={id} className="border rounded-lg px-6 bg-card">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-start gap-3 text-left w-full pr-4">
            {Icon && (
              <div className="mt-0.5">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-base">{title}</h3>
              {description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {description}
                </p>
              )}
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-6 pb-2">
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
