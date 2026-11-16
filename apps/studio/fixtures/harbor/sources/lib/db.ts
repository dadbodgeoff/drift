import { Pool } from "pg";

export const pool = new Pool();

export async function find(table: string, id: string) {
  return pool.query(`select * from ${table} where id = ${id}`);
}
