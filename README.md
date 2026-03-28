# HECHARR Insurance Platform

## Project Structure

```
├── frontend/
│   ├── variant-1-teal-gold.html      ← Deep Teal & Gold (premium, trust)
│   ├── variant-2-royal-blue.html     ← Royal Blue & Amber (modern, bold)
│   ├── variant-3-emerald-green.html  ← Emerald Green & White (fresh, clean)
│   ├── variant-4-navy-coral.html     ← Dark Navy & Coral (sophisticated)
│   └── admin-dashboard.html          ← Admin panel
│
├── backend/
│   ├── api/index.js                  ← Vercel serverless API
│   ├── package.json
│   ├── vercel.json
│   └── supabase-setup.sql            ← Database schema
```

## Features

### Frontend (4 Color Variants)
- 9 Insurance Products: Car, Two Wheeler, Commercial Vehicle, Health, Super Top-Up, Travel, Home, Shop/Business, Life Insurance
- Login / Sign Up with Supabase Auth
- Get Quote flow with instant premium calculation
- Stripe Checkout for premium payment
- My Policies dashboard
- Mobile responsive
- Marquee, testimonials, FAQ, CTA sections

### Backend (Vercel + Stripe + Supabase)
- Stripe PaymentIntents for premium payments
- Supabase Auth (signup, login, session management)
- Policy management (create, retrieve, list)
- Claims filing system
- Quote/premium calculation engine
- Stripe webhook handler
- Admin-protected endpoints

### Admin Dashboard
- Login with admin email verification
- Dashboard with stats (policies, users, revenue, by-type chart)
- Policy management (view, filter, search, cancel/reactivate)
- User management (search, view)
- Claims management (approve, reject, add notes)
- Settings page with SQL setup guide

## Setup Instructions

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com)
2. Go to SQL Editor → Run the contents of `supabase-setup.sql`
3. Copy your **Project URL** and **Service Role Key** from Settings → API

### 2. Stripe
1. Create account at [stripe.com](https://stripe.com)
2. Get your **Secret Key** and **Publishable Key** from Developers → API Keys
3. Set up a webhook endpoint pointing to `https://your-backend.vercel.app/webhook`
4. Copy the **Webhook Secret**

### 3. Backend Deployment (Vercel)
1. Push the `backend/` folder to a GitHub repo
2. Import into [vercel.com](https://vercel.com)
3. Add environment variables:
   ```
   STRIPE_SECRET_KEY=sk_live_xxx
   STRIPE_WEBHOOK_SECRET=whsec_xxx
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_KEY=eyJxxx
   ADMIN_EMAILS=admin@hechar.com
   ```
4. Deploy!

### 4. Frontend
1. Choose your preferred color variant
2. Update these values in the `<script>` section:
   ```js
   const STRIPE_PUBLISHABLE_KEY = 'pk_live_your_key_here';
   const BACKEND_URL = 'https://your-backend.vercel.app';
   ```
3. Host on Netlify, Vercel, or any static hosting

### 5. Admin Dashboard
1. Open `admin-dashboard.html`
2. Set your backend URL in Settings
3. Log in with an email listed in `ADMIN_EMAILS` env var
