import { useState } from "react";
import { toast } from "sonner";
import { launchConsole as launchConsoleApi, getJobExecutorUrl } from "@/lib/job-executor-api";
import { supabase } from "@/integrations/supabase/client";
import { logActivityDirect } from "@/hooks/useActivityLog";

// Check if we're in a mixed content scenario (HTTPS page trying HTTP API)
const checkMixedContent = (): boolean => {
  if (window.location.protocol !== 'https:') return false;
  
  const url = getJobExecutorUrl();
  return url?.startsWith('http://') ?? false;
};

export function useConsoleLauncher() {
  const [launching, setLaunching] = useState(false);

  const launchConsole = async (
    serverId: string,
    serverName: string
  ) => {
    setLaunching(true);
    const startTime = Date.now();

    // Skip instant API entirely if mixed content detected
    const isMixedContent = checkMixedContent();
    if (isMixedContent) {
      console.log("[ConsoleLauncher] Mixed content detected (HTTPS→HTTP), using job queue directly");
      return await launchViaJobQueue(serverId, serverName, startTime);
    }

    try {
      // Try instant API first (fast response)
      const result = await launchConsoleApi(serverId);
      
      if (result.success && result.console_url) {
        window.open(result.console_url, '_blank');
        setLaunching(false);
        
        // Log activity
        await logActivityDirect(
          'console_launch',
          'server',
          serverName,
          { requires_login: result.requires_login, method: 'instant_api' },
          { targetId: serverId, success: true, durationMs: Date.now() - startTime }
        );
        
        return { success: true };
      } else {
        throw new Error(result.error || "Failed to get console URL");
      }
    } catch (error: any) {
      // If instant API fails due to unreachable, fall back to job queue
      if (error.message?.includes("not running") || error.message?.includes("not reachable") || error.message?.includes("Failed to fetch")) {
        console.log("[ConsoleLauncher] Instant API unreachable, falling back to job queue");
        return await launchViaJobQueue(serverId, serverName, startTime);
      } else {
        // Log failed activity
        await logActivityDirect(
          'console_launch',
          'server',
          serverName,
          {},
          { targetId: serverId, success: false, durationMs: Date.now() - startTime, error: error.message }
        );
        
        toast.error("Console launch failed", {
          description: error.message,
        });
        setLaunching(false);
        return { success: false, error: error.message };
      }
    }
  };

  const launchViaJobQueue = async (
    serverId: string,
    serverName: string,
    startTime: number
  ): Promise<{ success: boolean; error?: string }> => {
    return new Promise(async (resolve) => {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        // Create console_launch job
        const { data: job, error: jobError } = await supabase
          .from("jobs")
          .insert({
            job_type: "console_launch",
            created_by: user.id,
            status: "pending",
            details: {
              server_id: serverId,
            },
            target_scope: {
              server_ids: [serverId],
            },
          })
          .select()
          .single();

        if (jobError) throw jobError;

        // Poll for results
        let pollCount = 0;
        const maxPolls = 15; // 30 seconds max (15 * 2s)
        
        const pollInterval = setInterval(async () => {
          pollCount++;
          
          const { data: updatedJob, error: pollError } = await supabase
            .from("jobs")
            .select("*")
            .eq("id", job.id)
            .single();

          if (pollError) {
            clearInterval(pollInterval);
            setLaunching(false);
            resolve({ success: false, error: pollError.message });
            return;
          }

          if (updatedJob.status === "completed") {
            clearInterval(pollInterval);
            const details = updatedJob.details as any;
            const consoleUrl = details?.console_url;
            
            if (consoleUrl) {
              window.open(consoleUrl, '_blank');
              
              // Log activity for job queue method
              await logActivityDirect(
                'console_launch',
                'server',
                serverName,
                { requires_login: details?.requires_login, method: 'job_queue' },
                { targetId: serverId, success: true, durationMs: Date.now() - startTime }
              );
              
              setLaunching(false);
              resolve({ success: true });
            } else {
              const errorMsg = "No console URL in job result";
              await logActivityDirect(
                'console_launch',
                'server',
                serverName,
                { method: 'job_queue' },
                { targetId: serverId, success: false, durationMs: Date.now() - startTime, error: errorMsg }
              );
              toast.error("Console launch failed", {
                description: errorMsg,
              });
              setLaunching(false);
              resolve({ success: false, error: errorMsg });
            }
          } else if (updatedJob.status === "failed") {
            clearInterval(pollInterval);
            const details = updatedJob.details as any;
            const errorMsg = details?.error || "Console launch failed";
            
            await logActivityDirect(
              'console_launch',
              'server',
              serverName,
              { method: 'job_queue' },
              { targetId: serverId, success: false, durationMs: Date.now() - startTime, error: errorMsg }
            );
            
            toast.error("Console launch failed", {
              description: errorMsg,
            });
            setLaunching(false);
            resolve({ success: false, error: errorMsg });
          } else if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            toast.error("Console launch timeout", {
              description: "Job took too long to complete",
            });
            setLaunching(false);
            resolve({ success: false, error: "Timeout" });
          }
        }, 2000);
      } catch (error: any) {
        setLaunching(false);
        toast.error("Console launch failed", {
          description: error.message,
        });
        resolve({ success: false, error: error.message });
      }
    });
  };

  return {
    launching,
    launchConsole,
  };
}
