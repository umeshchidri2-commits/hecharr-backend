-- ============================================================
-- HECHARR Insurance — Supabase Database Setup
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id TEXT,
  email TEXT UNIQUE NOT NULL,
  first_name TEXT DEFAULT '',
  last_name TEXT DEFAULT '',
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. POLICIES TABLE
CREATE TABLE IF NOT EXISTS policies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id TEXT UNIQUE NOT NULL,
  stripe_payment_intent_id TEXT,
  user_id UUID REFERENCES users(id),
  customer_email TEXT NOT NULL,
  customer_name TEXT DEFAULT '',
  customer_phone TEXT,
  policy_type TEXT NOT NULL,
  plan_name TEXT DEFAULT '',
  plan_details JSONB DEFAULT '{}',
  premium_amount NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'INR',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. CLAIMS TABLE
CREATE TABLE IF NOT EXISTS claims (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id TEXT UNIQUE NOT NULL,
  policy_id TEXT,
  customer_email TEXT,
  description TEXT,
  claim_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. INDEXES
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_policies_email ON policies(customer_email);
CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status);
CREATE INDEX IF NOT EXISTS idx_policies_type ON policies(policy_type);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_policy ON claims(policy_id);

-- 5. ROW LEVEL SECURITY (Optional — enable for production)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
