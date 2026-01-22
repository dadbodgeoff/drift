---
name: database-migrations
description: Safe database migration strategies for zero-downtime deployments. Covers backward-compatible changes, data migrations, and rollback procedures.
license: MIT
compatibility: TypeScript/JavaScript, Python
metadata:
  category: database
  time: 3h
  source: drift-masterguide
---

# Database Migrations

Change your schema without breaking production.

## When to Use This Skill

- Adding/removing columns
- Changing data types
- Creating indexes
- Data transformations
- Zero-downtime deployments

## The Golden Rule

**Every migration must be backward compatible with the previous version of your code.**

Why? During deployment, both old and new code versions run simultaneously.

## Safe Migration Patterns

### Adding a Column

```sql
-- ✅ SAFE: New column with default or nullable
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- ❌ UNSAFE: Required column without default
ALTER TABLE users ADD COLUMN phone VARCHAR(20) NOT NULL;
```

### Removing a Column

```
Phase 1: Stop using column in code (deploy)
Phase 2: Remove column from database (migrate)
```

### Renaming a Column

```
Phase 1: Add new column, write to both (deploy)
Phase 2: Backfill data (migrate)
Phase 3: Read from new column (deploy)
Phase 4: Remove old column (migrate)
```

## TypeScript Implementation

### Migration Runner

```typescript
// migration-runner.ts
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

interface Migration {
  id: string;
  name: string;
  up: string;
  down: string;
}

class MigrationRunner {
  constructor(private pool: Pool, private migrationsDir: string) {}

  async run(): Promise<void> {
    await this.ensureMigrationsTable();
    
    const applied = await this.getAppliedMigrations();
    const pending = await this.getPendingMigrations(applied);

    for (const migration of pending) {
      console.log(`Running migration: ${migration.name}`);
      
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        
        // Run migration
        await client.query(migration.up);
        
        // Record migration
        await client.query(
          'INSERT INTO migrations (id, name, applied_at) VALUES ($1, $2, NOW())',
          [migration.id, migration.name]
        );
        
        await client.query('COMMIT');
        console.log(`✓ ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`✗ ${migration.name}:`, error);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async rollback(steps = 1): Promise<void> {
    const applied = await this.getAppliedMigrations();
    const toRollback = applied.slice(-steps).reverse();

    for (const migrationId of toRollback) {
      const migration = await this.loadMigration(migrationId);
      
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.down);
        await client.query('DELETE FROM migrations WHERE id = $1', [migration.id]);
        await client.query('COMMIT');
        console.log(`Rolled back: ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  }

  private async ensureMigrationsTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  private async getAppliedMigrations(): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT id FROM migrations ORDER BY applied_at'
    );
    return result.rows.map(r => r.id);
  }

  private async getPendingMigrations(applied: string[]): Promise<Migration[]> {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    const pending: Migration[] = [];
    for (const file of files) {
      const id = file.replace('.sql', '');
      if (!applied.includes(id)) {
        pending.push(await this.loadMigration(id));
      }
    }
    return pending;
  }

  private async loadMigration(id: string): Promise<Migration> {
    const filePath = path.join(this.migrationsDir, `${id}.sql`);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    const [up, down] = content.split('-- DOWN');
    
    return {
      id,
      name: id,
      up: up.replace('-- UP', '').trim(),
      down: down?.trim() || '',
    };
  }
}

export { MigrationRunner };
```

### Migration File Format

```sql
-- migrations/20240115_001_add_phone_to_users.sql

-- UP
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
CREATE INDEX idx_users_phone ON users(phone);

-- DOWN
DROP INDEX idx_users_phone;
ALTER TABLE users DROP COLUMN phone;
```

### Zero-Downtime Column Rename

```typescript
// Step 1: Add new column (migration)
// 20240115_001_add_display_name.sql
`
-- UP
ALTER TABLE users ADD COLUMN display_name VARCHAR(255);

-- DOWN
ALTER TABLE users DROP COLUMN display_name;
`

// Step 2: Write to both columns (code change)
async function updateUser(id: string, name: string) {
  await db.query(
    'UPDATE users SET name = $1, display_name = $1 WHERE id = $2',
    [name, id]
  );
}

// Step 3: Backfill existing data (migration)
// 20240116_001_backfill_display_name.sql
`
-- UP
UPDATE users SET display_name = name WHERE display_name IS NULL;

-- DOWN
-- No rollback needed for data backfill
`

// Step 4: Read from new column (code change)
async function getUser(id: string) {
  const result = await db.query(
    'SELECT id, display_name as name FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

// Step 5: Remove old column (migration)
// 20240117_001_remove_name_column.sql
`
-- UP
ALTER TABLE users DROP COLUMN name;

-- DOWN
ALTER TABLE users ADD COLUMN name VARCHAR(255);
UPDATE users SET name = display_name;
`
```

### Safe Index Creation

```sql
-- ❌ UNSAFE: Locks table during creation
CREATE INDEX idx_orders_user ON orders(user_id);

-- ✅ SAFE: Non-blocking index creation
CREATE INDEX CONCURRENTLY idx_orders_user ON orders(user_id);
```

### Data Migration with Batching

```typescript
// data-migration.ts
async function migrateUserEmails(): Promise<void> {
  const BATCH_SIZE = 1000;
  let processed = 0;
  let lastId = '';

  while (true) {
    const users = await db.query(`
      SELECT id, email 
      FROM users 
      WHERE id > $1 
      ORDER BY id 
      LIMIT $2
    `, [lastId, BATCH_SIZE]);

    if (users.rows.length === 0) break;

    for (const user of users.rows) {
      await db.query(
        'UPDATE users SET email_normalized = LOWER($1) WHERE id = $2',
        [user.email, user.id]
      );
    }

    lastId = users.rows[users.rows.length - 1].id;
    processed += users.rows.length;
    console.log(`Processed ${processed} users`);

    // Avoid overwhelming the database
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

## Python Implementation

```python
# migration_runner.py
import os
import psycopg2
from datetime import datetime

class MigrationRunner:
    def __init__(self, connection_string: str, migrations_dir: str):
        self.conn = psycopg2.connect(connection_string)
        self.migrations_dir = migrations_dir

    def run(self):
        self._ensure_migrations_table()
        applied = self._get_applied_migrations()
        pending = self._get_pending_migrations(applied)

        for migration in pending:
            print(f"Running: {migration['name']}")
            cursor = self.conn.cursor()
            try:
                cursor.execute(migration['up'])
                cursor.execute(
                    "INSERT INTO migrations (id, name) VALUES (%s, %s)",
                    (migration['id'], migration['name'])
                )
                self.conn.commit()
                print(f"✓ {migration['name']}")
            except Exception as e:
                self.conn.rollback()
                print(f"✗ {migration['name']}: {e}")
                raise

    def _ensure_migrations_table(self):
        cursor = self.conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS migrations (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                applied_at TIMESTAMP DEFAULT NOW()
            )
        """)
        self.conn.commit()

    def _get_applied_migrations(self) -> list[str]:
        cursor = self.conn.cursor()
        cursor.execute("SELECT id FROM migrations ORDER BY applied_at")
        return [row[0] for row in cursor.fetchall()]

    def _get_pending_migrations(self, applied: list[str]) -> list[dict]:
        files = sorted(f for f in os.listdir(self.migrations_dir) if f.endswith('.sql'))
        pending = []
        for f in files:
            migration_id = f.replace('.sql', '')
            if migration_id not in applied:
                pending.append(self._load_migration(migration_id))
        return pending

    def _load_migration(self, migration_id: str) -> dict:
        path = os.path.join(self.migrations_dir, f"{migration_id}.sql")
        with open(path) as f:
            content = f.read()
        up, down = content.split('-- DOWN') if '-- DOWN' in content else (content, '')
        return {
            'id': migration_id,
            'name': migration_id,
            'up': up.replace('-- UP', '').strip(),
            'down': down.strip(),
        }
```

## Pre-Deployment Checklist

```markdown
- [ ] Migration is backward compatible
- [ ] Indexes created with CONCURRENTLY
- [ ] Large data migrations batched
- [ ] Rollback script tested
- [ ] Migration tested on production-like data
- [ ] Estimated lock time acceptable
```

## Best Practices

1. **One change per migration** - Easier to rollback
2. **Always write DOWN migrations** - You will need them
3. **Test on production data copy** - Size matters
4. **Use transactions** - Atomic changes
5. **Monitor during migration** - Watch for locks

## Common Mistakes

- Adding NOT NULL without default
- Creating indexes without CONCURRENTLY
- Large data migrations in single transaction
- No rollback plan
- Not testing with production data volume
