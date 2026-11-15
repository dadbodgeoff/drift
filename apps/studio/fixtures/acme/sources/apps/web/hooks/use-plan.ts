import { useEffect, useState } from "react";

export function usePlan() {
  const [value, setValue] = useState({ slug: "acme" });
  useEffect(() => {
    setValue((v) => ({ ...v }));
  }, []);
  return value;
}
