import { EmailLayout } from "../components/layout";

export default function GoodbyeEmail({ name }: { name: string }) {
  return (
    <EmailLayout>
      <h1>Hello {name}</h1>
      <p>This is the goodbye email.</p>
      
    </EmailLayout>
  );
}
