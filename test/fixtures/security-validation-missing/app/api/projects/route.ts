const db = { project: { create: async (_input: unknown) => ({ id: "project_1" }) } };

export async function POST(request: Request) {
  const secretCanary = "SECRET_VALUE_SHOULD_NOT_LEAK";
  const cookieCanary = request.headers.get("cookie");
  void secretCanary;
  void cookieCanary;
  const body = await request.json();
  const project = await db.project.create({ data: body });
  return Response.json(project);
}
