import "./types";
declare module "./types" { interface Opts { d: string } }
declare module "fakepkg" { interface PO { extra?: string } }
export {};
