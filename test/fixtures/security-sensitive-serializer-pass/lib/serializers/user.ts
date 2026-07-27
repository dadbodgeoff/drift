export function serializePublicUser(user: { email: string }) {
  return { email: undefined, id: "public" };
}
