"""
ZFS Agent - FastAPI Application Entry Point

A REST API service for managing ZFS appliances in the Dell Infra Sync DR system.
Replaces SSH-based scripts with a structured, observable API.
"""

import asyncio
import logging
import os
import ssl
import socket
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from zfs_agent import __version__
from zfs_agent.config import settings
from zfs_agent.routers import health, pools, snapshots, replication, jobs, exports
from zfs_agent.services.zfs import zfs_service
from zfs_agent.services.supabase_client import supabase_service

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def send_heartbeat():
    """Send periodic heartbeat to Supabase."""
    while True:
        try:
            # Get pool info for heartbeat
            pools_list = zfs_service.list_pools()
            pool_info = pools_list[0] if pools_list else None
            
            hostname = settings.hostname or socket.gethostname()
            api_url = f"{'https' if settings.ssl_enabled else 'http'}://{hostname}:{settings.api_port}"
            
            await supabase_service.send_heartbeat(
                hostname=hostname,
                agent_version=__version__,
                api_url=api_url,
                capabilities={
                    "features": ["snapshots", "replication", "nfs"],
                    "api_version": "v1"
                },
                pool_name=pool_info.name if pool_info else None,
                pool_size_bytes=pool_info.size_bytes if pool_info else None,
                pool_free_bytes=pool_info.free_bytes if pool_info else None,
                pool_health=pool_info.health if pool_info else None
            )
            logger.debug("Heartbeat sent successfully")
        except Exception as e:
            logger.error(f"Failed to send heartbeat: {e}")
        
        await asyncio.sleep(settings.heartbeat_interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info(f"ZFS Agent v{__version__} starting...")
    logger.info(f"Hostname: {settings.hostname}")
    logger.info(f"API Port: {settings.api_port}")
    
    # Check ZFS availability
    pools_list = zfs_service.list_pools()
    if pools_list:
        logger.info(f"Found {len(pools_list)} ZFS pool(s): {[p.name for p in pools_list]}")
    else:
        logger.warning("No ZFS pools found - agent will still start for pool initialization")
    
    # Start heartbeat task
    heartbeat_task = asyncio.create_task(send_heartbeat())
    
    # Send startup event
    await supabase_service.push_event(
        event_type="agent_started",
        severity="info",
        message=f"ZFS Agent v{__version__} started on {settings.hostname}",
        details={"pools": [p.name for p in pools_list]}
    )
    
    yield
    
    # Cleanup
    heartbeat_task.cancel()
    
    await supabase_service.push_event(
        event_type="agent_stopped",
        severity="info",
        message=f"ZFS Agent stopped on {settings.hostname}"
    )
    
    logger.info("ZFS Agent shutting down...")


# Create FastAPI app
app = FastAPI(
    title="ZFS Agent API",
    description="REST API for ZFS appliance management in Dell Infra Sync DR system",
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to known origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)}
    )


# Include routers
app.include_router(health.router)
app.include_router(pools.router)
app.include_router(snapshots.router)
app.include_router(replication.router)
app.include_router(jobs.router)
app.include_router(exports.router)


@app.get("/")
async def root():
    """Root endpoint - redirects to docs."""
    return {
        "name": "ZFS Agent",
        "version": __version__,
        "docs": "/docs",
        "health": "/v1/health"
    }


def run():
    """Run the application with uvicorn."""
    import uvicorn
    
    ssl_context = None
    if settings.ssl_enabled:
        if os.path.exists(settings.ssl_cert_path) and os.path.exists(settings.ssl_key_path):
            ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ssl_context.load_cert_chain(settings.ssl_cert_path, settings.ssl_key_path)
            logger.info("SSL enabled with certificate")
        else:
            logger.warning("SSL enabled but cert/key not found - starting without SSL")
    
    uvicorn.run(
        "zfs_agent.main:app",
        host=settings.api_host,
        port=settings.api_port,
        ssl_keyfile=settings.ssl_key_path if ssl_context else None,
        ssl_certfile=settings.ssl_cert_path if ssl_context else None,
        log_level=settings.log_level.lower()
    )


if __name__ == "__main__":
    run()
