import { slugify } from "../../lib/utils";
export default function handler(req, res) { res.json({ slug: slugify("Hello World") }); }
