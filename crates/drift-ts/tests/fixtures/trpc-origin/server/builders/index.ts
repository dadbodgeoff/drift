export { authed as guarded } from '../trpc';
export * from '../base';
import t2 from '../default-instance';

export const viaDefault = t2.procedure;
