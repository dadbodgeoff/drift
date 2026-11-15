export function factory<T>(seed: T) {
  return { ...seed, id: 1 };
}
