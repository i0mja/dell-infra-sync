import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { settingsTokens, settingsClasses } from './styles/settings-tokens';
import { LucideIcon } from 'lucide-react';

export interface SettingsTab {
  id: string;
  label: string;
  icon: LucideIcon;
  content: React.ReactNode;
}

interface SettingsTabLayoutProps {
  tabs: SettingsTab[];
  defaultTab?: string;
  sectionParamName?: string;
  /** Optional callback when section changes */
  onSectionChange?: (section: string) => void;
}

/**
 * Standardized tab layout for all settings pages.
 * Handles URL synchronization and consistent styling.
 */
export function SettingsTabLayout({
  tabs,
  defaultTab,
  sectionParamName = 'section',
  onSectionChange,
}: SettingsTabLayoutProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const currentSection = searchParams.get(sectionParamName) || defaultTab || tabs[0]?.id || 'overview';

  const handleSectionChange = (section: string) => {
    const newParams = new URLSearchParams(searchParams);
    
    // Remove section param if it's the default/first tab
    if (section === (defaultTab || tabs[0]?.id)) {
      newParams.delete(sectionParamName);
    } else {
      newParams.set(sectionParamName, section);
    }
    
    setSearchParams(newParams);
    onSectionChange?.(section);
  };

  return (
    <div className={settingsClasses.pageWrapper}>
      <Tabs value={currentSection} onValueChange={handleSectionChange}>
        <TabsList className={settingsTokens.tabsList}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className={settingsTokens.tabsTrigger}
            >
              <Icon className={settingsTokens.tabIcon} />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {tabs.map(({ id, content }) => (
          <TabsContent key={id} value={id} className={settingsTokens.tabsContent}>
            {content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
