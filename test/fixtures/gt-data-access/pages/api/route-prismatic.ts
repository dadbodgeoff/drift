import { prismaticGradient } from "../../lib/prismatic";
export default function handler(req, res) { res.json({ color: prismaticGradient(7) }); }
