"""Media upload handlers for ISOs and firmware"""

from typing import Dict
from datetime import datetime
import os
import requests
from pathlib import Path
from .base import BaseHandler


class MediaUploadHandler(BaseHandler):
    """Handles ISO and firmware file upload and scanning operations"""
    
    def execute_iso_upload(self, job: Dict):
        """Handle ISO upload from browser - save to local directory and serve via HTTP"""
        try:
            from job_executor.config import ISO_DIRECTORY, DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL, MEDIA_SERVER_PORT
            
            self.log(f"Starting ISO upload: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            iso_image_id = details.get('iso_image_id')
            filename = details.get('filename')
            iso_data = details.get('iso_data')
            
            if not iso_image_id or not filename or not iso_data:
                raise Exception("Missing required fields: iso_image_id, filename, or iso_data")
            
            self.log(f"Saving ISO: {filename}")
            
            # Ensure ISO directory exists
            Path(ISO_DIRECTORY).mkdir(parents=True, exist_ok=True)
            
            # Decode and save ISO
            import base64
            iso_path = os.path.join(ISO_DIRECTORY, filename)
            with open(iso_path, 'wb') as f:
                f.write(base64.b64decode(iso_data))
            
            file_size = os.path.getsize(iso_path)
            self.log(f"ISO saved: {file_size / (1024*1024):.2f} MB")
            
            # Calculate checksum
            import hashlib
            sha256 = hashlib.sha256()
            with open(iso_path, 'rb') as f:
                for chunk in iter(lambda: f.read(4096), b""):
                    sha256.update(chunk)
            checksum = sha256.hexdigest()
            
            # Get served URL from ISO server
            if self.executor.iso_server:
                iso_url = self.executor.iso_server.get_iso_url(filename)
            else:
                local_ip = self.executor.get_local_ip()
                iso_url = f"http://{local_ip}:{MEDIA_SERVER_PORT}/{filename}"
            
            # Update iso_images record
            update_response = requests.patch(
                f"{DSM_URL}/rest/v1/iso_images?id=eq.{iso_image_id}",
                json={
                    'upload_status': 'ready',
                    'upload_progress': 100,
                    'local_path': iso_path,
                    'served_url': iso_url,
                    'checksum': checksum,
                    'file_size_bytes': file_size,
                },
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                    'Content-Type': 'application/json',
                },
                verify=VERIFY_SSL
            )
            
            if update_response.status_code not in [200, 204]:
                raise Exception(f"Failed to update ISO image record: {update_response.status_code}")
            
            self.log(f"✓ ISO upload complete: {iso_url}")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'filename': filename,
                    'size_bytes': file_size,
                    'served_url': iso_url,
                    'checksum': checksum,
                }
            )
            
        except Exception as e:
            self.log(f"ISO upload failed: {e}", "ERROR")
            
            # Update ISO image status to error
            if details.get('iso_image_id'):
                try:
                    from job_executor.config import DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL
                    requests.patch(
                        f"{DSM_URL}/rest/v1/iso_images?id=eq.{details['iso_image_id']}",
                        json={'upload_status': 'error'},
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                            'Content-Type': 'application/json',
                        },
                        verify=VERIFY_SSL
                    )
                except:
                    pass
            
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_scan_local_isos(self, job: Dict):
        """Scan ISO_DIRECTORY for .iso files and register them in the database"""
        try:
            from job_executor.config import ISO_DIRECTORY, DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL, MEDIA_SERVER_PORT
            from job_executor.utils import _safe_json_parse
            
            self.log(f"Starting ISO directory scan: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            iso_dir = Path(ISO_DIRECTORY)
            if not iso_dir.exists():
                iso_dir.mkdir(parents=True, exist_ok=True)
                self.log(f"Created ISO directory: {ISO_DIRECTORY}")
            
            found_isos = []
            new_count = 0
            updated_count = 0
            
            # Get media server for URL generation
            if not self.executor.media_server:
                local_ip = self.executor.get_local_ip()
                base_url = f"http://{local_ip}:{MEDIA_SERVER_PORT}"
            else:
                base_url = f"http://{self.executor.media_server.get_local_ip()}:{MEDIA_SERVER_PORT}"
            
            # Scan for ISO files
            iso_files = list(iso_dir.glob("*.iso"))
            self.log(f"Found {len(iso_files)} ISO files in {ISO_DIRECTORY}")
            
            import hashlib
            
            for iso_path in iso_files:
                try:
                    filename = iso_path.name
                    file_size = iso_path.stat().st_size
                    
                    self.log(f"Processing: {filename} ({file_size / (1024*1024):.2f} MB)")
                    
                    # Calculate checksum
                    sha256 = hashlib.sha256()
                    with open(iso_path, 'rb') as f:
                        for chunk in iter(lambda: f.read(8192), b""):
                            sha256.update(chunk)
                    checksum = sha256.hexdigest()
                    
                    # Generate served URL
                    served_url = f"{base_url}/isos/{filename}"
                    
                    # Check if ISO already exists in database (by filename)
                    check_response = requests.get(
                        f"{DSM_URL}/rest/v1/iso_images?filename=eq.{filename}",
                        headers={
                            'apikey': SERVICE_ROLE_KEY,
                            'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        },
                        verify=VERIFY_SSL
                    )
                    
                    existing_isos = _safe_json_parse(check_response) if check_response.status_code == 200 else []
                    
                    iso_data = {
                        'filename': filename,
                        'file_size_bytes': file_size,
                        'checksum': checksum,
                        'local_path': str(iso_path),
                        'served_url': served_url,
                        'upload_status': 'ready',
                        'upload_progress': 100,
                        'source_type': 'local',
                    }
                    
                    if existing_isos:
                        # Update existing ISO
                        iso_id = existing_isos[0]['id']
                        update_response = requests.patch(
                            f"{DSM_URL}/rest/v1/iso_images?id=eq.{iso_id}",
                            json=iso_data,
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                            },
                            verify=VERIFY_SSL
                        )
                        
                        if update_response.status_code in [200, 204]:
                            updated_count += 1
                            found_isos.append({'id': iso_id, 'filename': filename, 'status': 'updated'})
                            self.log(f"  ✓ Updated: {filename}")
                        else:
                            self.log(f"  ✗ Failed to update: {filename}", "WARN")
                    else:
                        # Insert new ISO
                        insert_response = requests.post(
                            f"{DSM_URL}/rest/v1/iso_images",
                            json=iso_data,
                            headers={
                                'apikey': SERVICE_ROLE_KEY,
                                'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                                'Content-Type': 'application/json',
                                'Prefer': 'return=representation',
                            },
                            verify=VERIFY_SSL
                        )
                        
                        if insert_response.status_code in [200, 201]:
                            new_iso = _safe_json_parse(insert_response)[0]
                            new_count += 1
                            found_isos.append({'id': new_iso['id'], 'filename': filename, 'status': 'new'})
                            self.log(f"  ✓ Registered: {filename}")
                        else:
                            self.log(f"  ✗ Failed to register: {filename}", "WARN")
                    
                except Exception as iso_error:
                    self.log(f"Error processing {iso_path.name}: {iso_error}", "ERROR")
            
            result = {
                'directory': ISO_DIRECTORY,
                'total_found': len(iso_files),
                'new_count': new_count,
                'updated_count': updated_count,
                'isos': found_isos,
            }
            
            self.log(f"✓ ISO scan complete: {new_count} new, {updated_count} updated")
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details=result
            )
            
        except Exception as e:
            self.log(f"ISO scan failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_register_iso_url(self, job: Dict):
        """Register an ISO from a network URL (HTTP/HTTPS)"""
        try:
            from job_executor.config import (
                ISO_DIRECTORY, DSM_URL, SERVICE_ROLE_KEY, VERIFY_SSL, MEDIA_SERVER_PORT
            )
            from job_executor.utils import _safe_json_parse
            
            self.log(f"Starting ISO URL registration: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            details = job.get('details', {})
            iso_url = details.get('iso_url')
            filename = details.get('filename')
            description = details.get('description')
            tags = details.get('tags', [])
            download_local = details.get('download_local', False)
            
            if not iso_url:
                raise Exception("No iso_url provided")
            
            # Extract filename from URL if not provided
            if not filename:
                filename = os.path.basename(iso_url)
            
            if not filename.lower().endswith('.iso'):
                raise Exception(f"Invalid ISO filename: {filename}")
            
            self.log(f"Registering ISO from URL: {iso_url}")
            
            # Verify URL is accessible
            try:
                head_response = requests.head(iso_url, timeout=10, verify=VERIFY_SSL)
                if head_response.status_code not in [200, 302]:
                    raise Exception(f"URL not accessible: {head_response.status_code}")
                
                # Get file size from headers
                file_size = int(head_response.headers.get('Content-Length', 0))
                self.log(f"ISO size: {file_size / (1024*1024):.2f} MB")
            except Exception as e:
                raise Exception(f"Failed to verify ISO URL: {e}")
            
            local_path = None
            served_url = iso_url  # Default: use original URL
            checksum = None
            
            # Download to local storage if requested
            if download_local:
                self.log(f"Downloading ISO to local storage...")
                iso_dir = Path(ISO_DIRECTORY)
                iso_dir.mkdir(parents=True, exist_ok=True)
                
                local_path = str(iso_dir / filename)
                
                # Download with progress
                import hashlib
                sha256 = hashlib.sha256()
                
                get_response = requests.get(iso_url, stream=True, verify=VERIFY_SSL)
                get_response.raise_for_status()
                
                with open(local_path, 'wb') as f:
                    for chunk in get_response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            sha256.update(chunk)
                
                checksum = sha256.hexdigest()
                file_size = os.path.getsize(local_path)
                
                # Generate served URL from media server
                if self.executor.media_server:
                    served_url = self.executor.media_server.get_iso_url(filename)
                else:
                    local_ip = self.executor.get_local_ip()
                    served_url = f"http://{local_ip}:{MEDIA_SERVER_PORT}/isos/{filename}"
                
                self.log(f"✓ Downloaded to: {local_path}")
            
            # Check if ISO already exists in database
            check_response = requests.get(
                f"{DSM_URL}/rest/v1/iso_images?filename=eq.{filename}",
                headers={
                    'apikey': SERVICE_ROLE_KEY,
                    'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                },
                verify=VERIFY_SSL
            )
            
            existing_isos = _safe_json_parse(check_response) if check_response.status_code == 200 else []
            
            iso_data = {
                'filename': filename,
                'file_size_bytes': file_size,
                'checksum': checksum,
                'local_path': local_path,
                'served_url': served_url,
                'upload_status': 'ready',
                'upload_progress': 100,
                'source_type': 'url' if not download_local else 'local',
                'source_url': iso_url,
                'description': description,
                'tags': tags,
            }
            
            if existing_isos:
                # Update existing ISO
                iso_id = existing_isos[0]['id']
                update_response = requests.patch(
                    f"{DSM_URL}/rest/v1/iso_images?id=eq.{iso_id}",
                    json=iso_data,
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                    },
                    verify=VERIFY_SSL
                )
                
                if update_response.status_code not in [200, 204]:
                    raise Exception(f"Failed to update ISO: {update_response.status_code}")
                
                self.log(f"✓ Updated existing ISO: {filename}")
                result_status = 'updated'
            else:
                # Insert new ISO
                insert_response = requests.post(
                    f"{DSM_URL}/rest/v1/iso_images",
                    json=iso_data,
                    headers={
                        'apikey': SERVICE_ROLE_KEY,
                        'Authorization': f'Bearer {SERVICE_ROLE_KEY}',
                        'Content-Type': 'application/json',
                        'Prefer': 'return=representation',
                    },
                    verify=VERIFY_SSL
                )
                
                if insert_response.status_code not in [200, 201]:
                    raise Exception(f"Failed to register ISO: {insert_response.status_code}")
                
                self.log(f"✓ Registered new ISO: {filename}")
                result_status = 'registered'
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={
                    'filename': filename,
                    'served_url': served_url,
                    'status': result_status,
                    'downloaded_locally': download_local,
                    'size_bytes': file_size
                }
            )
            
        except Exception as e:
            self.log(f"ISO URL registration failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_firmware_upload(self, job: Dict):
        """Handle firmware package upload (placeholder - implement as needed)"""
        try:
            self.log(f"Starting firmware upload: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Implementation depends on firmware storage requirements
            # Similar to ISO upload but for firmware packages
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'message': 'Firmware upload not yet implemented'}
            )
            
        except Exception as e:
            self.log(f"Firmware upload failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
    
    def execute_catalog_sync(self, job: Dict):
        """Sync firmware catalog from Dell (placeholder - implement as needed)"""
        try:
            self.log(f"Starting catalog sync: {job['id']}")
            self.update_job_status(job['id'], 'running', started_at=datetime.now().isoformat())
            
            # Implementation for syncing Dell firmware catalog
            
            self.update_job_status(
                job['id'],
                'completed',
                completed_at=datetime.now().isoformat(),
                details={'message': 'Catalog sync not yet implemented'}
            )
            
        except Exception as e:
            self.log(f"Catalog sync failed: {e}", "ERROR")
            self.update_job_status(
                job['id'],
                'failed',
                completed_at=datetime.now().isoformat(),
                details={'error': str(e)}
            )
