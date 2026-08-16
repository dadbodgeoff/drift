// Thin wrapper around the public IMDb movie-info REST API. Pure HTTP fetch,
// no local database, no ORM, no persistence of any kind.
export async function fetchMovie(id: string) {
  const res = await fetch(`https://api.example-imdb.com/movies/${id}`);
  return res.json();
}
