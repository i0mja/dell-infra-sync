import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
    try {
      setBrowsing(true);
      setFiles([]);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create browse job
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
          toast({
            title: "Datastore browsed",
            description: `Found ${jobFiles.length} file(s)`,
          });
        } else if (updatedJob.status === "failed") {
          clearInterval(pollInterval);
          setBrowsing(false);
          const details = updatedJob.details as any;
          throw new Error(details?.error || "Browse failed");
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
