export async function searchUsers(query: string) {
  const response = await fetch(`https://internal.example.test/users?q=${encodeURIComponent(query)}`);
  return response.json();
}
