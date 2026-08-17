export async function countUsers(store: any) {
  return (await store.user.findMany()).length;
}
