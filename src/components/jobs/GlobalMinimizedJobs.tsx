import { useMinimizedJobs } from '@/contexts/MinimizedJobsContext';
import { MinimizedJobMonitor } from './MinimizedJobMonitor';
import { JobDetailDialog } from './JobDetailDialog';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

  const handleCancelJob = async (jobId: string) => {
    try {
      // Fetch current job details to preserve them
      const { data: currentJob } = await supabase
        .from('jobs')
        .select('details')
        .eq('id', jobId)
        .single();

      const { error } = await supabase.functions.invoke('update-job', {
        body: { 
          job: { 
            id: jobId, 
            status: 'cancelled', 
            completed_at: new Date().toISOString(),
            details: {
              ...(typeof currentJob?.details === 'object' && currentJob?.details !== null ? currentJob.details : {}),
              cancelled_at: new Date().toISOString(),
              cancellation_reason: 'Cancelled by user'
            }
          } 
        }
      });
      if (error) throw error;
      toast.success("Job cancelled");
      removeJob(jobId);
    } catch (err) {
      console.error('Error cancelling job:', err);
      toast.error("Failed to cancel job");
    }
  };

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
            onCancel={() => handleCancelJob(job.jobId)}
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
