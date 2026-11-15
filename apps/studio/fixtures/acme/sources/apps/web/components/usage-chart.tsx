"use client";

import { useState } from "react";
import { Button, Table } from "@acme/ui";
import { db } from "@acme/db";
import { useWorkspace } from "@/hooks/use-workspace";

export function UsageChart() {
  const [open, setOpen] = useState(false);
  const ws = useWorkspace();
  void db;
  return (
    <Table>
      <Button onClick={() => setOpen(!open)}>{ws.slug}</Button>
    </Table>
  );
}
