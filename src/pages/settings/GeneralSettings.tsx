import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/settings";
import { Palette, Sun, Moon, Monitor } from "lucide-react";

export function GeneralSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Appearance"
        description="Customize the look and feel of the application"
        icon={Palette}
      >
        <div className="space-y-4">
          <div>
            <Label>Theme</Label>
            <p className="text-sm text-muted-foreground mt-1">
              Choose your preferred color scheme
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              onClick={() => setTheme("light")}
              className="flex items-center gap-2 h-auto py-4 flex-col"
            >
              <Sun className="h-5 w-5" />
              <span>Light</span>
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              onClick={() => setTheme("dark")}
              className="flex items-center gap-2 h-auto py-4 flex-col"
            >
              <Moon className="h-5 w-5" />
              <span>Dark</span>
            </Button>
            <Button
              variant={theme === "system" ? "default" : "outline"}
              onClick={() => setTheme("system")}
              className="flex items-center gap-2 h-auto py-4 flex-col"
            >
              <Monitor className="h-5 w-5" />
              <span>System</span>
            </Button>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
