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
    
    def update_job_status(
        self,
        job_id: str,
        status: str,
        details: Optional[Dict] = None,
        error: Optional[str] = None
    ) -> bool:
        """
        Update job status in database
        
        Args:
            job_id: Job UUID
            status: New status (pending, running, completed, failed, cancelled)
            details: Optional details dict to merge with existing details
            error: Optional error message for failed jobs
            
        Returns:
            True if update successful, False otherwise
        """
        return self.executor.update_job_status(job_id, status, details, error)
    
    def update_task_status(
        self,
        task_id: str,
        status: str,
        progress: Optional[int] = None,
        log_message: Optional[str] = None
    ) -> bool:
        """
        Update task status in database
        
        Args:
            task_id: Task UUID
            status: New status (pending, running, completed, failed)
            progress: Optional progress percentage (0-100)
            log_message: Optional log message to append
            
        Returns:
            True if update successful, False otherwise
        """
        return self.executor.update_task_status(task_id, status, progress, log_message)
    
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
