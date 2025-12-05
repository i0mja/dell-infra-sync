"""
iDRAC Request Throttler & Safety Module
========================================

Prevents iDRAC lockups through:
- Per-IP request serialization
- Global concurrency limits
- Circuit breakers
- Exponential backoff
- Rate limiting
"""

import threading
import time
import random
import requests
from collections import defaultdict
from typing import Optional, Tuple

class IdracThrottler:
    """
    Manages per-IP request queuing, global concurrency limits, circuit breakers,
    and exponential backoff to prevent iDRAC lockups.
    """
    def __init__(self, verify_ssl: bool = False, max_concurrent: int = 4, 
                 request_delay_ms: int = 500, circuit_breaker_threshold: int = 3,
                 circuit_breaker_timeout: int = 1800):
        self.max_concurrent = max_concurrent  # Store for external access
        self.sessions = {}  # Per-IP requests.Session
        self.locks = defaultdict(threading.Lock)  # Per-IP locks
        self.last_request_time = {}  # Per-IP last request timestamp
        self.consecutive_failures = defaultdict(int)  # Per-IP failure counter
        self.circuit_breaker_open_until = {}  # Per-IP circuit breaker timeout
        self.global_semaphore = threading.Semaphore(max_concurrent)
        self.request_delay_ms = request_delay_ms
        self.verify_ssl = verify_ssl
        self.circuit_breaker_threshold = circuit_breaker_threshold
        self.circuit_breaker_timeout = circuit_breaker_timeout
        
        if not verify_ssl:
            import urllib3
            urllib3.disable_warnings()
        
    def get_session(self, ip: str) -> requests.Session:
        """Get or create a requests.Session for an IP"""
        if ip not in self.sessions:
            session = requests.Session()
            session.verify = self.verify_ssl
            self.sessions[ip] = session
        return self.sessions[ip]
    
    def close_session(self, ip: str):
        """Close and cleanup session for an IP"""
        if ip in self.sessions:
            try:
                self.sessions[ip].close()
            except:
                pass
            del self.sessions[ip]
    
    def is_circuit_open(self, ip: str) -> bool:
        """Check if circuit breaker is open for this IP"""
        if ip in self.circuit_breaker_open_until:
            if time.time() < self.circuit_breaker_open_until[ip]:
                return True
            else:
                # Circuit breaker timeout expired, reset
                del self.circuit_breaker_open_until[ip]
                self.consecutive_failures[ip] = 0
        return False
    
    def open_circuit(self, ip: str, logger):
        """Open circuit breaker for this IP"""
        self.circuit_breaker_open_until[ip] = time.time() + self.circuit_breaker_timeout
        minutes = self.circuit_breaker_timeout // 60
        logger(f"⚠️  CIRCUIT BREAKER OPENED for {ip} - pausing for {minutes} minutes", "WARN")
        logger(f"    Throttle event: circuit_breaker_open for {ip}", "INFO")
    
    def record_success(self, ip: str):
        """Record successful request"""
        self.consecutive_failures[ip] = 0
        if ip in self.circuit_breaker_open_until:
            del self.circuit_breaker_open_until[ip]
    
    def record_failure(self, ip: str, status_code: Optional[int], logger) -> bool:
        """
        Record failed request and check circuit breaker.
        Returns True if lockout risk detected.
        """
        self.consecutive_failures[ip] += 1
        
        # Check for lockout risk (401/403 errors)
        if status_code in [401, 403]:
            logger(f"⚠️  Authentication failure for {ip} (attempt {self.consecutive_failures[ip]})", "WARN")
            if self.consecutive_failures[ip] >= self.circuit_breaker_threshold:
                self.open_circuit(ip, logger)
                logger(f"    ⚠️  POSSIBLE ACCOUNT LOCKOUT RISK for {ip}!", "ERROR")
                logger(f"    All operations for this IP are paused for {self.circuit_breaker_timeout//60} minutes", "ERROR")
                return True
        
        # Check for general circuit breaker
        if self.consecutive_failures[ip] >= self.circuit_breaker_threshold:
            self.open_circuit(ip, logger)
            return True
        
        return False
    
    def wait_for_rate_limit(self, ip: str, logger):
        """Enforce minimum delay between requests to same IP"""
        if ip in self.last_request_time:
            elapsed_ms = (time.time() - self.last_request_time[ip]) * 1000
            if elapsed_ms < self.request_delay_ms:
                sleep_ms = self.request_delay_ms - elapsed_ms
                logger(f"    Throttle: delaying {int(sleep_ms)}ms for {ip}", "DEBUG")
                time.sleep(sleep_ms / 1000.0)
        self.last_request_time[ip] = time.time()
    
    def exponential_backoff(self, attempt: int) -> float:
        """Calculate exponential backoff with jitter"""
        base_delay = min(2 ** attempt, 60)  # Cap at 60 seconds
        jitter = random.uniform(0, 0.3 * base_delay)
        return base_delay + jitter

    def request_with_safety(self, method: str, url: str, ip: str, logger, **kwargs) -> Tuple:
        """
        Make a request with full safety measures:
        - Per-IP serialization
        - Global concurrency limit
        - Circuit breaker
        - Rate limiting
        - Exponential backoff on errors
        
        Returns: (response, elapsed_ms)
        Raises: Exception on failures
        """
        # Check circuit breaker first
        if self.is_circuit_open(ip):
            remaining = int(self.circuit_breaker_open_until[ip] - time.time())
            raise Exception(f"Circuit breaker open for {ip} (retry in {remaining}s)")
        
        # Acquire per-IP lock (serialize requests to same iDRAC)
        with self.locks[ip]:
            # Wait for rate limit
            self.wait_for_rate_limit(ip, logger)
            
            # Acquire global semaphore (limit total concurrent requests)
            with self.global_semaphore:
                session = self.get_session(ip)
                
                # Set short timeouts
                if 'timeout' not in kwargs:
                    kwargs['timeout'] = (2, 10)  # 2s connect, 10s read
                
                # Ensure Accept header
                if 'headers' not in kwargs:
                    kwargs['headers'] = {}
                if 'Accept' not in kwargs['headers']:
                    kwargs['headers']['Accept'] = 'application/json'
                
                # Exponential backoff retry loop
                max_attempts = 3
                for attempt in range(max_attempts):
                    try:
                        start_time = time.time()
                        response = session.request(method, url, **kwargs)
                        elapsed_ms = int((time.time() - start_time) * 1000)
                        
                        # Check for auth failures
                        if response.status_code in [401, 403]:
                            lockout_risk = self.record_failure(ip, response.status_code, logger)
                            if lockout_risk:
                                raise Exception(f"Possible account lockout detected for {ip} - operations paused")
                        elif response.status_code >= 400:
                            self.record_failure(ip, response.status_code, logger)
                        else:
                            self.record_success(ip)
                        
                        return response, elapsed_ms
                    
                    except requests.Timeout as e:
                        logger(f"⚠️  Timeout on {ip} (attempt {attempt+1}/{max_attempts})", "WARN")
                        self.record_failure(ip, None, logger)
                        if attempt < max_attempts - 1:
                            backoff = self.exponential_backoff(attempt)
                            logger(f"    Backing off {backoff:.1f}s before retry...", "INFO")
                            time.sleep(backoff)
                        else:
                            raise
                    
                    except requests.RequestException as e:
                        logger(f"⚠️  Request error on {ip}: {str(e)}", "WARN")
                        self.record_failure(ip, None, logger)
                        if attempt < max_attempts - 1:
                            backoff = self.exponential_backoff(attempt)
                            time.sleep(backoff)
                        else:
                            raise
    
    def lightweight_ping(self, ip: str, username: str, password: str, logger) -> Tuple[bool, Optional[str]]:
        """
        Lightweight connectivity check using GET /redfish/v1/ with short timeout.
        Returns: (success, error_message)
        """
        try:
            url = f"https://{ip}/redfish/v1/"
            response, elapsed_ms = self.request_with_safety(
                'GET', url, ip, logger,
                auth=(username, password),
                timeout=(2, 3)  # Very short timeout for ping
            )
            
            if response.status_code == 200:
                return True, None
            else:
                return False, f"HTTP {response.status_code}"
        except Exception as e:
            return False, str(e)
    
    def update_settings(self, max_concurrent: int, request_delay_ms: int):
        """Update throttler settings (from database)"""
        self.max_concurrent = max_concurrent  # Store for external access
        self.request_delay_ms = request_delay_ms
        # Recreate semaphore with new limit
        self.global_semaphore = threading.Semaphore(max_concurrent)
