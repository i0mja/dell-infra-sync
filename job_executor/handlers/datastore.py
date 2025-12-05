"""Datastore browser handler"""

from typing import Dict
from datetime import datetime, timezone
import time
from .base import BaseHandler
from job_executor.utils import utc_now_iso


class DatastoreHandler(BaseHandler):
    """Handles vCenter datastore browsing operations"""
    
    def execute_browse_datastore(self, job: Dict):
        """Browse files in a vCenter datastore"""
        try:
            from pyVim.connect import Disconnect
            from pyVmomi import vim
            
            self.log(f"Starting browse_datastore job: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=utc_now_iso())
            
            details = job.get('details', {})
            vcenter_id = details.get('vcenter_id')
            datastore_name = details.get('datastore_name')
            folder_path = details.get('folder_path', '')
            file_patterns = details.get('file_patterns', ['*.zip', '*.iso'])
            
            if not vcenter_id or not datastore_name:
                raise Exception("vcenter_id and datastore_name are required")
            
            # Get vCenter settings
            vcenter_settings = self.executor.get_vcenter_settings(vcenter_id)
            if not vcenter_settings:
                raise Exception(f"vCenter {vcenter_id} not found")
            
            # Connect to vCenter with fresh session
            self.log(f"Connecting to vCenter {vcenter_settings['host']}")
            
            # Clear any cached connection to ensure fresh session for browse operation
            if hasattr(self.executor, 'vcenter_conn'):
                self.executor.vcenter_conn = None
            
            si = self.executor.connect_vcenter(settings=vcenter_settings)
            if not si:
                raise Exception(f"Failed to connect to vCenter {vcenter_settings['host']}")
            
            content = si.RetrieveContent()
            
            # Validate session is active
            if hasattr(self.executor, 'check_vcenter_connection') and not self.executor.check_vcenter_connection(content):
                self.log("Session expired, reconnecting...", "WARN")
                self.executor.vcenter_conn = None
                si = self.executor.connect_vcenter(settings=vcenter_settings)
                if not si:
                    raise Exception("Failed to reconnect to vCenter")
                content = si.RetrieveContent()
            
            # Find datastore
            self.log(f"Finding datastore: {datastore_name}")
            container = content.viewManager.CreateContainerView(
                content.rootFolder, [vim.Datastore], True
            )
            
            datastore = None
            datastore_name_lower = datastore_name.lower()
            available_datastores = []
            
            for ds in container.view:
                ds_name = ds.summary.name
                available_datastores.append(ds_name)
                # Case-insensitive match
                if ds_name.lower() == datastore_name_lower:
                    datastore = ds
                    self.log(f"Found datastore: {ds_name}")
                    break
            
            container.Destroy()
            
            if not datastore:
                self.log(f"Available datastores in vCenter: {available_datastores}", "DEBUG")
                raise Exception(f"Datastore '{datastore_name}' not found. Available: {', '.join(available_datastores[:10])}")
            
            # Browse datastore using DatastoreBrowser
            self.log(f"Browsing datastore '{datastore_name}' for files matching {file_patterns}")
            browser = datastore.browser
            
            # Create search spec
            search_spec = vim.host.DatastoreBrowser.SearchSpec()
            search_spec.matchPattern = file_patterns
            search_spec.sortFoldersFirst = True
            
            # Search path
            datastore_path = f"[{datastore_name}] {folder_path}"
            
            # Execute search
            task = browser.SearchDatastoreSubFolders_Task(datastore_path, search_spec)
            
            # Wait for task to complete
            while task.info.state not in [vim.TaskInfo.State.success, vim.TaskInfo.State.error]:
                time.sleep(0.5)
            
            if task.info.state == vim.TaskInfo.State.error:
                raise Exception(f"Datastore browse failed: {task.info.error.msg}")
            
            # Collect results
            files = []
            results = task.info.result
            
            for folder_result in results:
                folder_path_result = folder_result.folderPath
                
                if hasattr(folder_result, 'file') and folder_result.file:
                    for file_info in folder_result.file:
                        # Build full path
                        full_path = f"{folder_path_result}{file_info.path}"
                        
                        files.append({
                            'name': file_info.path,
                            'size': file_info.fileSize if hasattr(file_info, 'fileSize') else 0,
                            'modified': file_info.modification.isoformat() if hasattr(file_info, 'modification') and file_info.modification else None,
                            'folder': folder_path_result,
                            'full_path': full_path,
                            'is_directory': isinstance(file_info, vim.host.DatastoreBrowser.FolderInfo)
                        })
            
            self.log(f"Found {len(files)} file(s) matching criteria")
            
            # Disconnect
            Disconnect(si)
            
            # Complete job with file list
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=utc_now_iso(),
                details={
                    'datastore_name': datastore_name,
                    'files': files,
                    'total_files': len(files)
                }
            )
            
        except Exception as e:
            self.log(f"Datastore browse failed: {e}", "ERROR")
            import traceback
            self.log(f"Traceback: {traceback.format_exc()}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=utc_now_iso(),
                details={'error': str(e)}
            )
