import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { browseDatastore as browseDatastoreApi } from "@/lib/job-executor-api";

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

    try {
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
        toast({
          title: "Datastore browsed",
          description: `Found ${mappedFiles.length} file(s)`,
        });
      } else {
        throw new Error(result.error || "Browse failed");
      }
    } catch (error: any) {
      toast({
        title: "Browse failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setBrowsing(false);
    }
  };

  return {
    browsing,
    files,
    browseDatastore,
  };
}
