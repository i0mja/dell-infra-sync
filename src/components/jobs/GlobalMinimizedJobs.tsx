import { useMinimizedJobs } from '@/contexts/MinimizedJobsContext';
import { MinimizedJobMonitor } from './MinimizedJobMonitor';

export const GlobalMinimizedJobs = () => {
  const { minimizedJobs, maximizeJob, removeJob } = useMinimizedJobs();

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
    </>
  );
};
