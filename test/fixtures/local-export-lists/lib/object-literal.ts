// The trap that rules out reading the statement text: this contains a brace pair and a comma-
// separated list, and a text-based reading yields a phantom export named `a:`.
export const config = { a: 1, b: 2 };
