"use client";

import { useState } from "react";
import { Button, Table } from "@acme/ui";
import { useWorkspace } from "@/hooks/use-workspace";

export function BillingCard() {
  const [open, setOpen] = useState(false);
  const ws = useWorkspace();
  const key = process.env.STRIPE_SECRET_KEY;
  return (
    <Table>
      <Button onClick={() => setOpen(!open)}>{ws.slug}</Button>
    </Table>
  );
}
