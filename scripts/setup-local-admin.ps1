#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Sets up a local admin user for testing Dell Server Manager
.DESCRIPTION
    This script clears any broken user data and creates a properly configured
    admin user using Supabase's signup API to ensure all columns are initialized correctly.
#>

Write-Host "Setting up local admin user..." -ForegroundColor Cyan

# Step 1: Clear broken user data
Write-Host "`n[1/5] Clearing existing user data..." -ForegroundColor Yellow
docker exec -i supabase_db_local psql -U postgres -d postgres -c "DELETE FROM auth.users; DELETE FROM public.user_roles; DELETE FROM public.profiles;" 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Cleared existing users" -ForegroundColor Green
} else {
    Write-Host "  ✗ Failed to clear users" -ForegroundColor Red
    exit 1
}

# Step 2: Create admin user via signup API
Write-Host "`n[2/5] Creating admin user via Supabase API..." -ForegroundColor Yellow

$headers = @{
    "apikey" = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
    "Content-Type" = "application/json"
}

$body = @{
    email = "admin@local.test"
    password = "admin123"
    email_confirm = $true
    data = @{
        full_name = "Local Admin"
    }
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:54321/auth/v1/signup" -Method POST -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "  ✓ Created user account" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Failed to create user: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Wait a moment for triggers to complete
Start-Sleep -Seconds 2

# Step 3: Assign admin role
Write-Host "`n[3/5] Assigning admin role..." -ForegroundColor Yellow
$roleResult = docker exec -i supabase_db_local psql -U postgres -d postgres -c "UPDATE public.user_roles SET role = 'admin'::app_role WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@local.test'); SELECT * FROM public.user_roles WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@local.test');" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Assigned admin role" -ForegroundColor Green
} else {
    Write-Host "  ✗ Failed to assign role" -ForegroundColor Red
    exit 1
}

# Step 4: Verify user creation
Write-Host "`n[4/5] Verifying user setup..." -ForegroundColor Yellow
$verifyResult = docker exec -i supabase_db_local psql -U postgres -d postgres -c "SELECT email, email_confirmed_at, created_at FROM auth.users WHERE email = 'admin@local.test';" 2>&1

if ($verifyResult -match "admin@local.test") {
    Write-Host "  ✓ User verified successfully" -ForegroundColor Green
} else {
    Write-Host "  ✗ User verification failed" -ForegroundColor Red
    exit 1
}

# Step 5: Display summary
Write-Host "`n[5/5] Setup complete!" -ForegroundColor Green
Write-Host "`nAdmin credentials:" -ForegroundColor Cyan
Write-Host "  Email:    admin@local.test" -ForegroundColor White
Write-Host "  Password: admin123" -ForegroundColor White
Write-Host "`nYou can now log in at: http://localhost:5173/auth" -ForegroundColor Cyan
Write-Host ""
