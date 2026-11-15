import pool from '../db';
import cache from '../db';

// Default imports whose local name is not a procedure builder stay ordinary calls.
export const rows = pool.query('select 1');
export const flushed = cache.mutation(() => null);
