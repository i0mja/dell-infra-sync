"""Virtual media mount/unmount handlers"""

from typing import Dict
from datetime import datetime
from .base import BaseHandler


class VirtualMediaHandler(BaseHandler):
    """Handles virtual media mount and unmount operations"""
    
    def execute_virtual_media_mount(self, job: Dict):
        """Execute virtual media mount job"""
        try:
            self.log(f"Starting virtual media mount job: {job['id']}")
            
            details = job.get('details', {})
            session_id = details.get('session_id')
            image_url = details.get('image_url')
            media_type = details.get('media_type', 'CD')
            write_protected = details.get('write_protected', True)
            
            if not session_id or not image_url:
                raise ValueError("session_id and image_url are required")
            
            # Update job status to running
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get target servers from job
            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])
            
            if not server_ids:
                raise ValueError("No target servers specified")
            
            # Process each server
            success_count = 0
            failed_count = 0
            results = []
            
            for server_id in server_ids:
                try:
                    # Get server details
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")
                    
                    ip = server['ip_address']
                    username, password = self.executor.get_credentials_for_server(server)
                    
                    self.log(f"  Mounting virtual media on {ip}...")
                    
                    # Mount the media
                    self.executor.mount_virtual_media(
                        ip, username, password,
                        server_id, job['id'],
                        image_url, media_type, write_protected
                    )
                    
                    # Verify mount status
                    status = self.executor.get_virtual_media_status(
                        ip, username, password,
                        server_id, job['id'],
                        media_type
                    )
                    
                    if status['inserted']:
                        # Update session in database
                        self.executor.supabase.table('virtual_media_sessions').update({
                            'is_mounted': True,
                            'inserted': True,
                            'mounted_at': datetime.now().isoformat()
                        }).eq('id', session_id).execute()
                        
                        self.log(f"  [OK] Virtual media mounted successfully on {ip}")
                        success_count += 1
                        results.append({
                            'server': ip,
                            'success': True,
                            'status': status
                        })
                    else:
                        raise Exception("Media not showing as inserted after mount")
                        
                except Exception as e:
                    self.log(f"  [X] Failed to mount on {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })
            
            # Update job status
            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results
                    }
                )
                self.log(f"Virtual media mount job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )
                
        except Exception as e:
            self.log(f"Virtual media mount job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_virtual_media_unmount(self, job: Dict):
        """Execute virtual media unmount job"""
        try:
            self.log(f"Starting virtual media unmount job: {job['id']}")
            
            details = job.get('details', {})
            session_id = details.get('session_id')
            media_type = details.get('media_type', 'CD')
            
            if not session_id:
                raise ValueError("session_id is required")
            
            # Update job status to running
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Get target servers
            target_scope = job.get('target_scope', {})
            server_ids = target_scope.get('server_ids', [])
            
            if not server_ids:
                raise ValueError("No target servers specified")
            
            success_count = 0
            failed_count = 0
            results = []
            
            for server_id in server_ids:
                try:
                    server = self.get_server_by_id(server_id)
                    if not server:
                        raise Exception(f"Server not found: {server_id}")
                    
                    ip = server['ip_address']
                    username, password = self.executor.get_credentials_for_server(server)
                    
                    self.log(f"  Unmounting virtual media on {ip}...")
                    
                    # Unmount the media
                    self.executor.unmount_virtual_media(
                        ip, username, password,
                        server_id, job['id'],
                        media_type
                    )
                    
                    # Verify unmount status
                    status = self.executor.get_virtual_media_status(
                        ip, username, password,
                        server_id, job['id'],
                        media_type
                    )
                    
                    if not status['inserted']:
                        # Update session in database
                        self.executor.supabase.table('virtual_media_sessions').update({
                            'is_mounted': False,
                            'inserted': False,
                            'unmounted_at': datetime.now().isoformat()
                        }).eq('id', session_id).execute()
                        
                        self.log(f"  [OK] Virtual media unmounted successfully on {ip}")
                        success_count += 1
                        results.append({
                            'server': ip,
                            'success': True,
                            'status': status
                        })
                    else:
                        raise Exception("Media still showing as inserted after unmount")
                        
                except Exception as e:
                    self.log(f"  [X] Failed to unmount on {ip}: {e}", "ERROR")
                    failed_count += 1
                    results.append({
                        'server': ip,
                        'success': False,
                        'error': str(e)
                    })
            
            # Update job status
            if failed_count == 0:
                self.update_job_status(
                    job['id'],
                    'completed',
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'results': results
                    }
                )
                self.log(f"Virtual media unmount job completed successfully")
            else:
                status = 'failed' if success_count == 0 else 'completed'
                self.update_job_status(
                    job['id'],
                    status,
                    completed_at=datetime.now().isoformat(),
                    details={
                        'success_count': success_count,
                        'failed_count': failed_count,
                        'results': results
                    }
                )
                
        except Exception as e:
            self.log(f"Virtual media unmount job failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
