-- Add replica identity for real-time updates (if not already set)
ALTER TABLE room_messages REPLICA IDENTITY FULL;
ALTER TABLE room_members REPLICA IDENTITY FULL;
ALTER TABLE direct_messages REPLICA IDENTITY FULL;

-- Function to automatically delete empty rooms
CREATE OR REPLACE FUNCTION delete_empty_rooms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Delete rooms with no active members
  DELETE FROM public.rooms
  WHERE id = COALESCE(NEW.room_id, OLD.room_id)
    AND active_members = 0
    AND id NOT IN (
      SELECT room_id 
      FROM public.room_members 
      WHERE is_active = true
    );
  
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Trigger to delete empty rooms after member changes
DROP TRIGGER IF EXISTS trigger_delete_empty_rooms ON room_members;
CREATE TRIGGER trigger_delete_empty_rooms
AFTER INSERT OR UPDATE OR DELETE ON room_members
FOR EACH ROW
EXECUTE FUNCTION delete_empty_rooms();

-- Add last_seen column for member activity tracking
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS last_seen timestamp with time zone DEFAULT now();

-- Update last_seen on member activity
CREATE OR REPLACE FUNCTION update_member_last_seen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.room_members
  SET last_seen = now()
  WHERE room_id = NEW.room_id AND user_id = NEW.user_id;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_last_seen ON room_messages;
CREATE TRIGGER trigger_update_last_seen
AFTER INSERT ON room_messages
FOR EACH ROW
EXECUTE FUNCTION update_member_last_seen();