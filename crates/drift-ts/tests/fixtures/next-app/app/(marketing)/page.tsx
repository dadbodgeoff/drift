import { Layout } from "@/components/layout";
import { Button } from "@/components/button";
// `baseUrl: "."` lets this bare-looking specifier resolve in the repo.
import { Card } from "components/ui/card";

export default function Page() {
  return (
    <Layout>
      <Button kind="primary" />
      <Card />
    </Layout>
  );
}
