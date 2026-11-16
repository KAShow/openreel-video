/**
 * Hawsh Khalifa integration ("Director's Eyes" library inside the editor).
 * The editor is opened from https://hawsh-khalifa.com/tools/director/editor with a one-time sign-in
 * code (#hk=…&pk=…). With it the editor gets its own Supabase session for the same project and can
 * read the user's generations/references and save exports to "My references". Without it the editor
 * works exactly as before.
 */
export const HAWSH_SUPABASE_URL = "https://dlqwvovmllggneslyuuz.supabase.co";
export const HAWSH_EDITOR_PAGE = "https://hawsh-khalifa.com/tools/director/editor";
/** The site page that signs the user in and brings them back to this tab (?return=1, Front DirectorEditorPage). */
export const HAWSH_SIGN_IN_URL = `${HAWSH_EDITOR_PAGE}?return=1`;
/** The editor's name everywhere it is shown. */
export const HAWSH_EDITOR_NAME = "مونتاج عيون المخرج";
/** Private bucket of the user's references (uploads). Insert policy: `{uid}/<file>.{jpg,png,webp,mp4,mov}`. */
export const HAWSH_REF_BUCKET = "director-refs";
/** director-refs bucket file size limit. */
export const HAWSH_LIBRARY_MAX_BYTES = 100 * 1024 * 1024;
export const HAWSH_PAGE_SIZE = 40;
