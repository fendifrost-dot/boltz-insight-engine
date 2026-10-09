-- Staff training contains customer information. No public reads or client writes.
-- Playback URLs are issued only after the server checks contacts.read.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('desk-training', 'desk-training', false, 62914560, ARRAY['video/mp4'])
ON CONFLICT (id) DO NOTHING;
