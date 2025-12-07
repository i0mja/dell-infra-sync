-- Add copy_template_cross_vcenter to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'copy_template_cross_vcenter';