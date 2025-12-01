import { useMinimizedJobs } from '@/contexts/MinimizedJobsContext';
import { MinimizedJobMonitor } from './MinimizedJobMonitor';
import { JobDetailDialog } from './JobDetailDialog';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const GlobalMinimizedJobs = () => {
  const { minimizedJobs, maximizedJob, maximizeJob, removeJob, closeMaximizedJob } = useMinimizedJobs();
  const [maximizedJobData, setMaximizedJobData] = useState<any>(null);

  // Fetch full job data when maximizedJob changes
  useEffect(() => {
    if (maximizedJob) {
      const fetchJob = async () => {
        const { data } = await supabase
          .from('jobs')
          .select('*')
          .eq('id', maximizedJob.jobId)
          .single();
        
        if (data) {
          setMaximizedJobData(data);
        }
      };
      fetchJob();
    } else {
      setMaximizedJobData(null);
    }
  }, [maximizedJob]);

  return (
    <>
      {minimizedJobs.map((job, index) => (
        <div
          key={job.jobId}
          style={{
            position: 'fixed',
            bottom: `${4 + index * 140}px`, // Stack monitors vertically
            right: '1rem',
            zIndex: 50,
          }}
        >
          <MinimizedJobMonitor
            jobId={job.jobId}
            jobType={job.jobType}
            onMaximize={() => maximizeJob(job.jobId)}
            onClose={() => removeJob(job.jobId)}
          />
        </div>
      ))}

      {/* Maximized job detail dialog */}
      <JobDetailDialog
        job={maximizedJobData}
        open={!!maximizedJob}
        onOpenChange={(open) => {
          if (!open) closeMaximizedJob();
        }}
      />
    </>
  );
};
