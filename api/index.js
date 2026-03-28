// ============================================================
// HECHARR INSURANCE Backend — Vercel Serverless
// Stripe Payments + Supabase Auth + Policy Management + Admin
// ============================================================

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ===== CORS =====
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    const allowed =
      origin.endsWith('.netlify.app') ||
      origin.endsWith('.hechar.com') ||
      origin === 'https://hechar.com' ||
      origin.endsWith('.vercel.app') ||
      origin === 'http://localhost:3000' ||
      origin === 'http://localhost:5500' ||
      origin === 'http://localhost:8080' ||
      origin === 'http://127.0.0.1:5500' ||
      origin === 'http://127.0.0.1:3000' ||
      origin === 'http://127.0.0.1:8080' ||
      origin === 'null';
    if (allowed) return callback(null, true);
    console.warn('CORS blocked origin:', origin);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true
}));

// Webhook raw body MUST be before express.json()
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// ===== SUPABASE (service role — full access) =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ===== ADMIN AUTH MIDDLEWARE =====
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!req.user || !ADMIN_EMAILS.includes(req.user.email.toLowerCase())) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
}

// ===== HEALTH CHECK =====
app.get('/', (req, res) => {
  res.json({
    message: '🛡️ HECHARR Insurance Backend is live!',
    status: 'ok',
    platform: 'vercel',
    timestamp: new Date().toISOString(),
    stripe: process.env.STRIPE_SECRET_KEY ? '✅' : '❌ MISSING',
    supabase: process.env.SUPABASE_URL ? '✅' : '❌ MISSING'
  });
});

// ===== AUTH: SIGN UP =====
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const { data, error } = await supabase.auth.admin.createUser({
      email, password,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName }
    });

    if (error) {
      if (error.message.toLowerCase().includes('already')) {
        return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
      }
      return res.status(400).json({ error: error.message });
    }

    await supabase.from('users').upsert({
      auth_user_id: data.user.id,
      email,
      first_name: firstName || '',
      last_name: lastName || '',
      phone: phone || null,
    }, { onConflict: 'email' });

    // Auto-login
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    const name = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];

    if (loginError || !loginData.session) {
      return res.json({
        success: true,
        user: { id: data.user.id, email, name, firstName, lastName, phone: phone || '' },
        session: null
      });
    }

    res.json({
      success: true,
      user: { id: data.user.id, email, name, firstName, lastName, phone: phone || '' },
      session: {
        access_token: loginData.session.access_token,
        refresh_token: loginData.session.refresh_token,
        expires_at: loginData.session.expires_at
      }
    });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== AUTH: LOGIN =====
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Incorrect email or password.' });

    const { data: profile } = await supabase
      .from('users')
      .select('first_name, last_name, phone')
      .eq('email', email)
      .maybeSingle();

    const firstName = profile?.first_name || data.user.user_metadata?.first_name || '';
    const lastName = profile?.last_name || data.user.user_metadata?.last_name || '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0];

    const isAdmin = ADMIN_EMAILS.includes(email.toLowerCase());

    res.json({
      success: true,
      user: { id: data.user.id, email, name, firstName, lastName, phone: profile?.phone || '' },
      isAdmin,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== CREATE PAYMENT INTENT (Insurance Premium Payment) =====
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency, customer, policyType, planDetails } = req.body;

    if (!amount || isNaN(amount) || amount < 50) {
      return res.status(400).json({ error: 'Invalid amount.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validEmail = customer?.email && emailRegex.test(customer.email) ? customer.email : null;
    const useCurrency = (currency || 'INR').toUpperCase();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: useCurrency.toLowerCase(),
      metadata: {
        customer_email: validEmail || '',
        customer_name: `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim(),
        policy_type: policyType || '',
        plan_name: planDetails?.name || '',
      },
      description: `HECHARR Insurance — ${policyType || 'Policy'} Premium`,
      receipt_email: validEmail || undefined,
      payment_method_types: ['card']
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== SAVE POLICY =====
app.post('/save-policy', async (req, res) => {
  try {
    const { paymentIntentId, customer, policyType, planDetails, total, currency, authUserId } = req.body;

    if (!paymentIntentId || !customer?.email) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: `Payment not completed. Status: ${paymentIntent.status}` });
    }

    // Upsert user
    let userId = null;
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', customer.email)
      .maybeSingle();

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { data: newUser } = await supabase
        .from('users')
        .insert({
          auth_user_id: authUserId || null,
          email: customer.email,
          first_name: customer.firstName || '',
          last_name: customer.lastName || '',
          phone: customer.phone || null,
        })
        .select('id')
        .single();
      userId = newUser?.id || null;
    }

    const policyId = 'HCI' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 4).toUpperCase();

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const { error: policyError } = await supabase
      .from('policies')
      .insert({
        policy_id: policyId,
        stripe_payment_intent_id: paymentIntentId,
        user_id: userId,
        customer_email: customer.email,
        customer_name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
        customer_phone: customer.phone || null,
        policy_type: policyType,
        plan_name: planDetails?.name || '',
        plan_details: planDetails || {},
        premium_amount: total,
        currency: (currency || 'INR').toUpperCase(),
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        status: 'active',
      });

    if (policyError) throw policyError;

    console.log(`✅ Policy saved: ${policyId} — ${policyType} — ${customer.email}`);
    res.json({ success: true, policyId });
  } catch (err) {
    console.error('Save policy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===== MY POLICIES (authenticated) =====
app.get('/my-policies', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not authenticated.' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session.' });

    const { data: policies, error: polError } = await supabase
      .from('policies')
      .select('*')
      .eq('customer_email', user.email)
      .order('created_at', { ascending: false });

    if (polError) throw polError;
    res.json({ success: true, policies: policies || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET QUOTE (calculate premium) =====
app.post('/get-quote', async (req, res) => {
  try {
    const { policyType, details } = req.body;

    // Simple premium calculation engine
    let basePremium = 0;
    let coverAmount = 0;

    switch (policyType) {
      case 'car':
        basePremium = details.vehicleValue * 0.03;
        coverAmount = details.vehicleValue;
        break;
      case 'two-wheeler':
        basePremium = details.vehicleValue * 0.02;
        coverAmount = details.vehicleValue;
        break;
      case 'commercial':
        basePremium = details.vehicleValue * 0.04;
        coverAmount = details.vehicleValue;
        break;
      case 'health':
        basePremium = details.coverAmount * 0.025;
        coverAmount = details.coverAmount;
        if (details.age > 45) basePremium *= 1.5;
        if (details.age > 60) basePremium *= 2;
        break;
      case 'travel':
        basePremium = details.tripDays * 150;
        coverAmount = 500000;
        break;
      case 'home':
        basePremium = details.propertyValue * 0.005;
        coverAmount = details.propertyValue;
        break;
      case 'shop':
        basePremium = details.shopValue * 0.008;
        coverAmount = details.shopValue;
        break;
      case 'life':
        basePremium = details.coverAmount * 0.015;
        coverAmount = details.coverAmount;
        if (details.age > 40) basePremium *= 1.3;
        break;
      default:
        basePremium = 5000;
        coverAmount = 500000;
    }

    const plans = [
      { name: 'Basic', premium: Math.round(basePremium * 0.7), cover: coverAmount, features: ['Third Party Cover', 'Basic Support'] },
      { name: 'Standard', premium: Math.round(basePremium), cover: coverAmount, features: ['Comprehensive Cover', 'Roadside Assistance', '24/7 Support'] },
      { name: 'Premium', premium: Math.round(basePremium * 1.4), cover: coverAmount * 1.5, features: ['Full Cover', 'Zero Depreciation', 'Priority Claims', 'Personal Manager'] },
    ];

    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========================================
// ADMIN ENDPOINTS
// ========================================

// Admin: Get all policies
app.get('/admin/policies', requireAdmin, async (req, res) => {
  try {
    const { status, type, search, page = 1, limit = 20 } = req.query;
    let query = supabase.from('policies').select('*', { count: 'exact' });

    if (status) query = query.eq('status', status);
    if (type) query = query.eq('policy_type', type);
    if (search) query = query.or(`customer_email.ilike.%${search}%,customer_name.ilike.%${search}%,policy_id.ilike.%${search}%`);

    query = query.order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ success: true, policies: data || [], total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Update policy status
app.patch('/admin/policies/:policyId', requireAdmin, async (req, res) => {
  try {
    const { policyId } = req.params;
    const { status } = req.body;

    const { error } = await supabase
      .from('policies')
      .update({ status })
      .eq('policy_id', policyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get all users
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    let query = supabase.from('users').select('*', { count: 'exact' });
    if (search) query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    query = query.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({ success: true, users: data || [], total: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Dashboard stats
app.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { count: totalPolicies } = await supabase.from('policies').select('*', { count: 'exact', head: true });
    const { count: activePolicies } = await supabase.from('policies').select('*', { count: 'exact', head: true }).eq('status', 'active');
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });

    const { data: revenueData } = await supabase.from('policies').select('premium_amount').eq('status', 'active');
    const totalRevenue = (revenueData || []).reduce((sum, p) => sum + (p.premium_amount || 0), 0);

    const { data: byType } = await supabase.from('policies').select('policy_type');
    const typeCounts = {};
    (byType || []).forEach(p => { typeCounts[p.policy_type] = (typeCounts[p.policy_type] || 0) + 1; });

    res.json({
      success: true,
      stats: { totalPolicies, activePolicies, totalUsers, totalRevenue, byType: typeCounts }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Claims management
app.get('/admin/claims', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('claims').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, claims: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/admin/claims/:claimId', requireAdmin, async (req, res) => {
  try {
    const { claimId } = req.params;
    const { status, notes } = req.body;
    const { error } = await supabase.from('claims').update({ status, admin_notes: notes }).eq('claim_id', claimId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== FILE CLAIM (authenticated user) =====
app.post('/file-claim', requireAuth, async (req, res) => {
  try {
    const { policyId, description, claimAmount } = req.body;
    if (!policyId || !description) return res.status(400).json({ error: 'Policy ID and description required.' });

    const claimId = 'CLM' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 3).toUpperCase();

    const { error } = await supabase.from('claims').insert({
      claim_id: claimId,
      policy_id: policyId,
      customer_email: req.user.email,
      description,
      claim_amount: claimAmount || 0,
      status: 'pending',
    });

    if (error) throw error;
    res.json({ success: true, claimId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== STRIPE WEBHOOK =====
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  switch (event.type) {
    case 'payment_intent.succeeded':
      console.log(`✅ Payment succeeded ${event.data.object.id}`);
      break;
    case 'payment_intent.payment_failed':
      console.log(`❌ Payment failed ${event.data.object.id}`);
      break;
    default:
      console.log(`Webhook: ${event.type}`);
  }
  res.json({ received: true });
});

// ===== EXPORT FOR VERCEL =====
module.exports = app;
