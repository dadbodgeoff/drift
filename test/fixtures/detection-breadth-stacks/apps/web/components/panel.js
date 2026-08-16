// D-PA2: JSX in a plain .js file, which the suffix-chosen grammar could not read. The setOpen and
// map call sites below were dropped with the scan reporting full success.
import { useState } from "react";
import { regionOf } from "../lib/only-list";

export function Panel({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div onClick={() => setOpen(false)} data-region={regionOf()}>
      {items.map((item) => (
        <span key={item.id}>{item.label}</span>
      ))}
    </div>
  );
}
