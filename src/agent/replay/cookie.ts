/**
 * What the page and the dev server share about a replay: the cookie that names
 * it, and the form of a local one's id. No Node imports: arm.ts runs in the
 * browser, and server.ts reads local replays from disk.
 */

export const REPLAY_COOKIE = "materia-agent-replay";

/** A local replay's id: `local-` and a plain name (nothing that could leave the data folder). */
export const LOCAL_REPLAY = /^local-[A-Za-z0-9_-]+$/;
