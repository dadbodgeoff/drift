export async function GET() {
  const mod = await import("@acme/database");
  const users = await mod.prisma.user.findMany();
  return Response.json({ users });
}
