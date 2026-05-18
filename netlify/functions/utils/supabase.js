// netlify/functions/utils/supabase.js
// Server-side Supabase client — uses SERVICE ROLE KEY (never exposed to frontend)

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl  = process.env.SUPABASE_URL;
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }
});

module.exports = { supabase };
