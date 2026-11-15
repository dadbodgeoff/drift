declare function legacy(o: legacy.Opts): void;
declare namespace legacy { interface Opts { a: string; b?: string } }
export = legacy;
