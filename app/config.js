// Supabase project "Billfish Log" (us-east-1).
// The anon key is meant to be public: it only lets the browser talk to the API.
// What each person can read or change is enforced in the database by row level security
// (see supabase/migrations). Never put a service_role key in this file.
// Pilot program: the app serves one boat. People join it with its boat code (or the invite link).
// Set to false (and re-grant create_boat in the database) to let other boats sign up and run their own logs.
export const PILOT_BOAT_ONLY = true;
export const APP_NAME = 'Catherine Anne Fishing Log';

export const SUPABASE_URL = 'https://ooxoyiyvvnebiopogiob.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9veG95aXl2dm5lYmlvcG9naW9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NzE5NjUsImV4cCI6MjExMTE0Nzk2NX0.TyKv4cAfljkM-gtbDMxMejc2yi5KylEXlyFLPO8SJk4';
