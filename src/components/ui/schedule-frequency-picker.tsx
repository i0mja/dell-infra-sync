import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface ScheduleFrequencyPickerProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const PRESETS = [
  { label: 'Every 6 hours', cron: '0 */6 * * *', description: 'Runs at 00:00, 06:00, 12:00, 18:00' },
  { label: 'Daily', cron: '0 0 * * *', description: 'Runs daily at midnight' },
  { label: 'Twice daily', cron: '0 0,12 * * *', description: 'Runs at 00:00 and 12:00' },
  { label: 'Weekly', cron: '0 0 * * 0', description: 'Runs every Sunday at midnight' },
];

export function ScheduleFrequencyPicker({ value, onChange, className }: ScheduleFrequencyPickerProps) {
  const [isCustom, setIsCustom] = useState(!PRESETS.some(p => p.cron === value));
  const activePreset = PRESETS.find(p => p.cron === value);

  const handlePresetClick = (cron: string) => {
    setIsCustom(false);
    onChange(cron);
  };

  const handleCustomClick = () => {
    setIsCustom(true);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset.cron}
            type="button"
            variant={!isCustom && value === preset.cron ? "default" : "outline"}
            size="sm"
            onClick={() => handlePresetClick(preset.cron)}
          >
            {preset.label}
          </Button>
        ))}
        <Button
          type="button"
          variant={isCustom ? "default" : "outline"}
          size="sm"
          onClick={handleCustomClick}
        >
          Custom
        </Button>
      </div>

      {isCustom ? (
        <div className="space-y-2">
          <Label>Cron Expression</Label>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0 */6 * * *"
          />
          <p className="text-xs text-muted-foreground">
            Format: minute hour day month weekday (e.g., "0 */6 * * *" for every 6 hours)
          </p>
        </div>
      ) : activePreset && (
        <p className="text-sm text-muted-foreground">
          {activePreset.description}
        </p>
      )}
    </div>
  );
}
