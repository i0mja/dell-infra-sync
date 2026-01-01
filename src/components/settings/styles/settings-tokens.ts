/**
 * Centralized design tokens for all settings pages.
 * These ensure visual consistency across Security, Infrastructure, System, 
 * Notification, Identity Management, and General settings.
 */

export const settingsTokens = {
  // Tab container - pill-style with muted background
  tabsList: "w-full justify-start h-auto p-1 bg-muted/50 rounded-lg",
  
  // Tab trigger - consistent sizing and active state
  tabsTrigger: "flex items-center gap-2 px-4 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-md",
  
  // Tab icon size
  tabIcon: "h-4 w-4",
  
  // Content spacing below tabs
  tabsContent: "mt-6",
  
  // Section spacing between cards/sections
  sectionSpacing: "space-y-6",
  
  // Card padding
  cardPadding: "p-6",
  
  // Grid layouts
  statsGrid: "grid gap-4 md:grid-cols-2 lg:grid-cols-4",
  twoColumnGrid: "grid gap-4 md:grid-cols-2",
  
  // Quick actions container
  quickActionsRow: "flex flex-wrap gap-2",
} as const;

// CSS class combinations for common patterns
export const settingsClasses = {
  // Page wrapper
  pageWrapper: "space-y-6",
  
  // Overview stat card
  statCard: "p-4 border rounded-lg bg-card",
  statCardMuted: "p-4 border rounded-lg bg-muted/30",
  
  // Header with title and action
  sectionHeader: "flex items-center justify-between",
  sectionTitle: "text-lg font-semibold",
  sectionDescription: "text-sm text-muted-foreground",
  
  // Loading state
  loadingContainer: "flex items-center justify-center h-64",
  loadingSpinner: "animate-spin rounded-full h-8 w-8 border-b-2 border-primary",
} as const;
