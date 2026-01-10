import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { MinimizedJobsProvider } from "@/contexts/MinimizedJobsContext";
import { ServerOperationsProvider } from "@/contexts/ServerOperationsContext";
import { JobExecutorProvider } from "@/contexts/JobExecutorContext";
import { GlobalSearchProvider } from "@/contexts/GlobalSearchContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalMinimizedJobs } from "@/components/jobs/GlobalMinimizedJobs";
import { GlobalSearchDialog } from "@/components/search/GlobalSearchDialog";
import Layout from "@/components/Layout";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import Servers from "./pages/Servers";
import Settings from "./pages/Settings";
import VCenter from "./pages/VCenter";
import ActivityMonitor from "./pages/ActivityMonitor";
import MaintenancePlanner from "./pages/MaintenancePlanner";
import Reports from "./pages/Reports";
import UpdateReport from "./pages/UpdateReport";
import Pdus from "./pages/Pdus";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <JobExecutorProvider>
                <MinimizedJobsProvider>
                  <NotificationProvider>
                    <ServerOperationsProvider>
                      <GlobalSearchProvider>
                        <GlobalMinimizedJobs />
                        <GlobalSearchDialog />
                        <Routes>
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/" element={<Layout />}>
                        <Route index element={<Dashboard />} />
                <Route path="servers" element={<Servers />} />
                <Route path="vcenter" element={<VCenter />} />
                <Route path="replication" element={<Navigate to="/vcenter?tab=replication" replace />} />
                <Route path="maintenance-planner" element={<MaintenancePlanner />} />
                <Route path="activity" element={<ActivityMonitor />} />
                <Route path="pdus" element={<Pdus />} />
                <Route path="reports" element={<Reports />} />
                <Route path="reports/updates/:scanId" element={<UpdateReport />} />
                <Route path="settings" element={<Settings />} />
                      </Route>
                      <Route path="*" element={<NotFound />} />
                      </Routes>
                      </GlobalSearchProvider>
                    </ServerOperationsProvider>
                  </NotificationProvider>
                </MinimizedJobsProvider>
              </JobExecutorProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
