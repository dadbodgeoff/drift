import { useEffect, useState } from "react";

export function useWebhooks() {
  const [value, setValue] = useState({ slug: "acme" });
  useEffect(() => {
    setValue((v) => ({ ...v }));
  }, []);
  return value;
}
