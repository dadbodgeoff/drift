import { fetchMovie } from "../../lib/imdb";
export default function handler(req, res) { res.json(fetchMovie("tt0111161")); }
