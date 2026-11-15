/** See local-sources.mjs: a reader for `local/<id>/sources/<path>` URLs under a fixtures directory. */
export function localSources(fixturesDir: string): (urlPath: string) => Buffer | null;
