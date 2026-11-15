export function Footer({ unsubscribe }: { unsubscribe?: string }) {
  return <footer>Acme Inc. {unsubscribe ? <a href={unsubscribe}>Unsubscribe</a> : null}</footer>;
}
