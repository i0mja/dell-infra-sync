"""Base handler class for job execution"""

from typing import Dict, Optional, Any
from datetime import datetime


class BaseHandler:
    """Base class for all job handlers with shared utilities"""
    
    def __init__(self, executor):
        """
        Initialize handler with reference to main executor
        
        Args:
            executor: JobExecutor instance providing access to mixins and utilities
        """
        self.executor = executor
    
    def log(self, message: str, level: str = "INFO"):
        """
        Log message with timestamp
        
        Args:
            message: Log message
            level: Log level (INFO, WARN, ERROR, DEBUG)
        """
        self.executor.log(message, level)
    
    def update_job_status(self, job_id: str, status: str, **kwargs) -> bool:
        """
        Update job status in database
        
        Args:
            job_id: Job UUID
            status: New status (pending, running, completed, failed, cancelled)
            **kwargs: Additional arguments (details, error, started_at, completed_at, etc.)
            
        Returns:
            True if update successful, False otherwise
        """
        return self.executor.update_job_status(job_id, status, **kwargs)
    
    def update_task_status(
        self,
        task_id: str,
        status: str,
        log: Optional[str] = None,
        progress: Optional[int] = None,
        **kwargs
    ) -> bool:
        """
        Update task status in database
        
        Args:
            task_id: Task UUID
            status: New status (pending, running, completed, failed)
            log: Optional log message to append
            progress: Optional progress percentage (0-100)
            **kwargs: Additional arguments
            
        Returns:
            True if update successful, False otherwise
        """
        return self.executor.update_task_status(task_id, status, log=log, progress=progress, **kwargs)
    
    def create_task(
        self,
        job_id: str,
        server_id: Optional[str] = None,
        vcenter_host_id: Optional[str] = None
    ) -> Optional[str]:
        """
        Create a new task for a job
        
        Args:
            job_id: Parent job UUID
            server_id: Optional server UUID
            vcenter_host_id: Optional vCenter host UUID
            
        Returns:
            Task UUID if created successfully, None otherwise
        """
        return self.executor.create_task(job_id, server_id, vcenter_host_id)
    
    def get_server_by_id(self, server_id: str) -> Optional[Dict]:
        """
        Fetch server record from database
        
        Args:
            server_id: Server UUID
            
        Returns:
            Server dict or None if not found
        """
        return self.executor.get_server_by_id(server_id)
    
    def get_job_tasks(self, job_id: str) -> list:
        """
        Fetch all tasks for a job
        
        Args:
            job_id: Job UUID
            
        Returns:
            List of task dicts
        """
        return self.executor.get_job_tasks(job_id)
    
    def handle_error(
        self,
        job: Dict,
        error: Exception,
        task_id: Optional[str] = None,
        context: str = ""
    ):
        """
        Standard error handling pattern for job execution
        
        Args:
            job: Job dict
            error: Exception that occurred
            task_id: Optional task UUID to update
            context: Context description for error message
        """
        error_msg = f"{context}: {str(error)}" if context else str(error)
        self.log(f"Job {job['id']} failed: {error_msg}", "ERROR")
        
        # Update task if provided
        if task_id:
            self.update_task_status(task_id, "failed", log_message=error_msg)
        
        # Update job
        self.update_job_status(job['id'], "failed", error=error_msg)
    
    def mark_job_running(self, job: Dict) -> bool:
        """
        Mark job as running with started_at timestamp
        
        Args:
            job: Job dict
            
        Returns:
            True if successful
        """
        return self.update_job_status(job['id'], "running")
    
    def mark_job_completed(self, job: Dict, details: Optional[Dict] = None) -> bool:
        """
        Mark job as completed with optional result details
        
        Args:
            job: Job dict
            details: Optional result details
            
        Returns:
            True if successful
        """
        return self.update_job_status(job['id'], "completed", details=details)
    
    def mark_job_failed(self, job: Dict, error: str, details: Optional[Dict] = None) -> bool:
        """
        Mark job as failed with error message
        
        Args:
            job: Job dict
            error: Error message
            details: Optional additional details
            
        Returns:
            True if successful
        """
        return self.update_job_status(job['id'], "failed", details=details, error=error)
    
    def check_cancelled(self, job_id: str) -> bool:
        """
        Check if job has been cancelled.
        Use this during long-running operations.
        
        Args:
            job_id: Job UUID
            
        Returns:
            True if job cancelled, False otherwise
        """
        return self.executor.is_job_cancelled(job_id)
    
    def update_job_details_field(self, job_id: str, updates: Dict) -> bool:
        """
        Update specific fields in job details without overwriting other fields.
        Useful for adding real-time progress data like iDRAC job queue.
        
        Args:
            job_id: Job UUID
            updates: Dict of fields to merge into existing details
            
        Returns:
            True if successful, False otherwise
        """
        import requests
        from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
        
        headers = {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
            "Content-Type": "application/json"
        }
        
        try:
            # Fetch current details
            response = requests.get(
                f"{DSM_URL}/rest/v1/jobs",
                params={'id': f"eq.{job_id}", 'select': 'details'},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            
            current_data = response.json() if response.ok else []
            current_details = current_data[0].get('details', {}) if current_data else {}
            if current_details is None:
                current_details = {}
            
            # Merge updates into existing details
            merged = {**current_details, **updates}
            
            # Update job with merged details
            patch_response = requests.patch(
                f"{DSM_URL}/rest/v1/jobs",
                params={'id': f"eq.{job_id}"},
                json={'details': merged},
                headers=headers,
                verify=VERIFY_SSL,
                timeout=10
            )
            return patch_response.ok
        except Exception as e:
            self.log(f"Warning: Could not update job details: {e}", "WARN")
            return False
