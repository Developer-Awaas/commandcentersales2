-- Run manually: supabase db query --linked -f supabase/rollbacks/20260612235959_create_aanya_training_creatives_down.sql
-- WARNING: destructive on any environment where this table holds real data
-- (prod). Only intended for tearing down a fresh/test project.
DROP TABLE IF EXISTS aanya_training_creatives;
