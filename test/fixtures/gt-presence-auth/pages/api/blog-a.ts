import { withAuthorHat } from "../../lib/blog";

export default withAuthorHat(function handler(req, res, byline) {
  const id = req.query.id;
  res.json({ ok: true, route: "blog-a", id, author: byline.author });
});
