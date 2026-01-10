-- Add pdu_api to operation_type enum for PDU instant API logging
ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'pdu_api';