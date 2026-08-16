// Unrelated color/gradient utility. Name happens to start with "prisma".
export function prismaticGradient(seed: number) {
  return `hsl(${seed % 360}, 80%, 60%)`;
}
