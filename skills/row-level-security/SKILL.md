---
name: row-level-security
description: Implement PostgreSQL Row Level Security (RLS) for multi-tenant SaaS applications. Use when building apps where users should only see their own data, or when implementing organization-based data isolation.
license: MIT
compatibility: PostgreSQL, Supabase, any PostgreSQL-compatible database
metadata:
  category: auth
  time: 4h
  source: drift-masterguide
---

# Row Level Security (RLS)

Database-level data isolation for multi-tenant applications.

## When to Use This Skill

- Building multi-tenant SaaS applications
- Ensuring users can only access their own data
- Implementing organization-based data isolation
- Adding defense-in-depth security layer

## Why RLS?

Application-level filtering can be bypassed. RLS enforces access at the database level:

```
❌ Application Filter: SELECT * FROM posts WHERE user_id = ?
   (Bug in code = data leak)

✅ RLS Policy: User can ONLY see rows where user_id matches
   (Database enforces, impossible to bypass)
```

## Basic Setup

### Enable RLS on Tables

```sql
-- Enable RLS (required first step)
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Force RLS for table owners too (important!)
ALTER TABLE posts FORCE ROW LEVEL SECURITY;
```

### User-Based Policies

```sql
-- Users can only see their own posts
CREATE POLICY "Users can view own posts"
  ON posts FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert posts as themselves
CREATE POLICY "Users can create own posts"
  ON posts FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update their own posts
CREATE POLICY "Users can update own posts"
  ON posts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Users can delete their own posts
CREATE POLICY "Users can delete own posts"
  ON posts FOR DELETE
  USING (user_id = auth.uid());
```

## Organization-Based Multi-Tenancy

### Schema Setup

```sql
-- Organizations table
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Organization memberships
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- Projects belong to organizations
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
```

### Organization Policies

```sql
-- Helper function: Get user's organizations
CREATE OR REPLACE FUNCTION get_user_organizations()
RETURNS SETOF UUID AS $$
  SELECT organization_id 
  FROM organization_members 
  WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users can see organizations they belong to
CREATE POLICY "Members can view organization"
  ON organizations FOR SELECT
  USING (id IN (SELECT get_user_organizations()));

-- Users can see projects in their organizations
CREATE POLICY "Members can view org projects"
  ON projects FOR SELECT
  USING (organization_id IN (SELECT get_user_organizations()));

-- Only admins can create projects
CREATE POLICY "Admins can create projects"
  ON projects FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id 
      FROM organization_members 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'owner')
    )
  );
```

## Role-Based Policies

```sql
-- Define roles
CREATE TYPE user_role AS ENUM ('viewer', 'editor', 'admin', 'owner');

-- Role hierarchy helper
CREATE OR REPLACE FUNCTION has_role(
  required_role user_role,
  org_id UUID
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE user_id = auth.uid()
    AND organization_id = org_id
    AND role::user_role >= required_role
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Viewers can read
CREATE POLICY "Viewers can read"
  ON projects FOR SELECT
  USING (has_role('viewer', organization_id));

-- Editors can update
CREATE POLICY "Editors can update"
  ON projects FOR UPDATE
  USING (has_role('editor', organization_id))
  WITH CHECK (has_role('editor', organization_id));

-- Admins can delete
CREATE POLICY "Admins can delete"
  ON projects FOR DELETE
  USING (has_role('admin', organization_id));
```

## Supabase-Specific Setup

### Auth Helper Functions

```sql
-- Get current user ID (Supabase)
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::json->>'sub',
    (current_setting('request.jwt.claims', true)::json->>'user_id')
  )::UUID
$$ LANGUAGE sql STABLE;

-- Get current user's email
CREATE OR REPLACE FUNCTION auth.email()
RETURNS TEXT AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'email'
$$ LANGUAGE sql STABLE;
```

### Service Role Bypass

```sql
-- Allow service role to bypass RLS (for admin operations)
CREATE POLICY "Service role bypass"
  ON projects FOR ALL
  USING (auth.role() = 'service_role');
```

## TypeScript Integration

### Supabase Client Setup

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Client-side (respects RLS)
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Server-side with service role (bypasses RLS)
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### Querying with RLS

```typescript
// This automatically filters by RLS policies
async function getUserProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select('*');
  
  // Only returns projects user has access to
  return data;
}

// Admin operation (bypasses RLS)
async function getAllProjects() {
  const { data, error } = await supabaseAdmin
    .from('projects')
    .select('*');
  
  // Returns ALL projects
  return data;
}
```

## Testing RLS Policies

```sql
-- Test as specific user
SET request.jwt.claims = '{"sub": "user-uuid-here"}';

-- Run query (should be filtered)
SELECT * FROM projects;

-- Reset
RESET request.jwt.claims;
```

### Automated Tests

```typescript
// __tests__/rls.test.ts
describe('RLS Policies', () => {
  it('user can only see own projects', async () => {
    // Create two users
    const user1 = await createTestUser();
    const user2 = await createTestUser();
    
    // User1 creates a project
    const project = await createProject(user1.id, 'Secret Project');
    
    // User2 tries to access
    const client = createClientAsUser(user2);
    const { data } = await client.from('projects').select('*');
    
    // Should not see user1's project
    expect(data).not.toContainEqual(
      expect.objectContaining({ id: project.id })
    );
  });
});
```

## Performance Considerations

### Index for RLS Columns

```sql
-- Always index columns used in RLS policies
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_projects_org_id ON projects(organization_id);
CREATE INDEX idx_org_members_user_org ON organization_members(user_id, organization_id);
```

### Avoid Expensive Functions

```sql
-- ❌ Bad: Subquery in every row check
CREATE POLICY "slow_policy"
  ON posts FOR SELECT
  USING (user_id IN (SELECT user_id FROM complex_view));

-- ✅ Good: Use SECURITY DEFINER function with caching
CREATE OR REPLACE FUNCTION get_accessible_user_ids()
RETURNS SETOF UUID AS $$
  SELECT user_id FROM simple_lookup WHERE condition
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "fast_policy"
  ON posts FOR SELECT
  USING (user_id IN (SELECT get_accessible_user_ids()));
```

## Best Practices

1. **Enable RLS on ALL tables with user data**: Don't forget any table
2. **Use FORCE ROW LEVEL SECURITY**: Applies to table owners too
3. **Create helper functions**: Reuse logic across policies
4. **Index RLS columns**: Critical for performance
5. **Test policies thoroughly**: Verify isolation works

## Common Mistakes

- Forgetting to enable RLS (table is wide open)
- Not using FORCE (table owner bypasses policies)
- Complex subqueries in policies (performance killer)
- Not indexing policy columns
- Trusting application-level filtering alone

## Security Checklist

- [ ] RLS enabled on all user-data tables
- [ ] FORCE ROW LEVEL SECURITY set
- [ ] Policies cover SELECT, INSERT, UPDATE, DELETE
- [ ] Service role key only used server-side
- [ ] Helper functions use SECURITY DEFINER
- [ ] Policies tested with multiple users
- [ ] Indexes on all RLS columns
