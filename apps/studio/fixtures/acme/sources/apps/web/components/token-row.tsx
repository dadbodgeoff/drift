"use client";

import { useState } from "react";
import { Button, Table } from "@acme/ui";
import { useWorkspace } from "@/hooks/use-workspace";

export function TokenRow() {
  const [open, setOpen] = useState(false);
  const ws = useWorkspace();
  return (
    <Table>
      <Button onClick={() => setOpen(!open)}>{ws.slug}</Button>
    </Table>
  );
}
