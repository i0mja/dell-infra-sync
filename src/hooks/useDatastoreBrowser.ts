import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { browseDatastore as browseDatastoreApi } from "@/lib/job-executor-api";
import { supabase } from "@/integrations/supabase/client";
import { logActivityDirect } from "@/hooks/useActivityLog";

export interface DatastoreFile {
  name: string;
  size: number;
  modified: string | null;
  folder: string;
  full_path: string;
  is_directory: boolean;
}

export function useDatastoreBrowser() {
  const { toast } = useToast();
  const [browsing, setBrowsing] = useState(false);
  const [files, setFiles] = useState<DatastoreFile[]>([]);

  const browseDatastore = async (
    vcenterId: string,
    datastoreName: string,
    folderPath: string = "",
    filePatterns: string[] = ["*.zip", "*.iso"]
  ) => {
    setBrowsing(true);
    setFiles([]);
    const startTime = Date.now();

    try {
      // Try instant API first (fast response)
      const result = await browseDatastoreApi(vcenterId, datastoreName, folderPath, filePatterns);
      
      if (result.success && result.files) {
        const mappedFiles: DatastoreFile[] = result.files.map((f) => ({
          name: f.name,
          size: f.size,
          modified: f.modified,
          folder: f.folder,
          full_path: f.full_path,
          is_directory: f.is_directory,
        }));
        setFiles(mappedFiles);
        setBrowsing(false);
        
        // Log activity
        await logActivityDirect(
          'datastore_browse',
          'datastore',
          datastoreName,
          { vcenter_id: vcenterId, folder_path: folderPath, files_found: mappedFiles.length },
          { success: true, durationMs: Date.now() - startTime }
        );
        
        toast({
          title: "Datastore browsed",
          description: `Found ${mappedFiles.length} file(s)`,
        });
      } else {
        throw new Error(result.error || "Browse failed");
      }
    } catch (error: any) {
      // If instant API fails due to unreachable, fall back to job queue
      if (error.message?.includes("not running") || error.message?.includes("not reachable")) {
        console.log("[DatastoreBrowser] Instant API unreachable, falling back to job queue");
        await browseViaJobQueue(vcenterId, datastoreName, folderPath, filePatterns, startTime);
      } else {
        // Log failed activity
        await logActivityDirect(
          'datastore_browse',
          'datastore',
          datastoreName,
          { vcenter_id: vcenterId, folder_path: folderPath },
          { success: false, durationMs: Date.now() - startTime, error: error.message }
        );
        
        toast({
          title: "Browse failed",
          description: error.message,
          variant: "destructive",
        });
        setBrowsing(false);
      }
    }
  };

  const browseViaJobQueue = async (
    vcenterId: string,
    datastoreName: string,
    folderPath: string,
    filePatterns: string[],
    startTime: number
  ) => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create browse job (this is a background job, still goes to jobs table)
      const { data: job, error: jobError } = await supabase
        .from("jobs")
        .insert({
          job_type: "browse_datastore",
          created_by: user.id,
          status: "pending",
          details: {
            vcenter_id: vcenterId,
            datastore_name: datastoreName,
            folder_path: folderPath,
            file_patterns: filePatterns,
          },
        })
        .select()
        .single();

      if (jobError) throw jobError;

      toast({
        title: "Browsing datastore",
        description: "Using job queue (may take a few seconds)...",
      });

      // Poll for results
      const pollInterval = setInterval(async () => {
        const { data: updatedJob, error: pollError } = await supabase
          .from("jobs")
          .select("*")
          .eq("id", job.id)
          .single();

        if (pollError) {
          clearInterval(pollInterval);
          throw pollError;
        }

        if (updatedJob.status === "completed") {
          clearInterval(pollInterval);
          const details = updatedJob.details as any;
          const jobFiles = (details?.files || []) as DatastoreFile[];
          setFiles(jobFiles);
          setBrowsing(false);
          
          // Log activity for job queue method too
          await logActivityDirect(
            'datastore_browse',
            'datastore',
            datastoreName,
            { vcenter_id: vcenterId, folder_path: folderPath, files_found: jobFiles.length, method: 'job_queue' },
            { success: true, durationMs: Date.now() - startTime }
          );
          
          toast({
            title: "Datastore browsed",
            description: `Found ${jobFiles.length} file(s)`,
          });
        } else if (updatedJob.status === "failed") {
          clearInterval(pollInterval);
          setBrowsing(false);
          const details = updatedJob.details as any;
          const errorMsg = details?.error || "Browse failed";
          
          await logActivityDirect(
            'datastore_browse',
            'datastore',
            datastoreName,
            { vcenter_id: vcenterId, folder_path: folderPath, method: 'job_queue' },
            { success: false, durationMs: Date.now() - startTime, error: errorMsg }
          );
          
          throw new Error(errorMsg);
        }
      }, 2000);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        if (browsing) {
          setBrowsing(false);
          toast({
            title: "Browse timeout",
            description: "Datastore browse took too long",
            variant: "destructive",
          });
        }
      }, 30000);
    } catch (error: any) {
      setBrowsing(false);
      toast({
        title: "Browse failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return {
    browsing,
    files,
    browseDatastore,
  };
}
