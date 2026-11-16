export function withSession(handler: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    if (!req.headers.get("authorization")) return new Response("unauthorized", { status: 401 });
    return handler(req);
  };
}
