import { sql } from "./server-db";

export const listUsers = () => sql("select 1");
