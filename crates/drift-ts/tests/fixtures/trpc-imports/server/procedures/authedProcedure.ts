import { isAuthed, publicProcedure } from '../trpc';

const authedProcedure = publicProcedure.use(isAuthed);

export default authedProcedure;
