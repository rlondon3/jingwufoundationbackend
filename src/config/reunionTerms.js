/**
 * Canonical deposit terms for the Jing Wu Foundation Reunion (Beijing 2027).
 *
 * The server is the source of truth for this text: the client sends only the
 * version it displayed, and checkout is rejected if that version doesn't match
 * what's here. That way we never record consent to wording the payer didn't see.
 *
 * Keep REUNION_TERMS_VERSION in step with the frontend copy in
 * jingwufoundation/src/constants/reunionTerms.ts — bump the version whenever
 * REUNION_TERMS_TEXT changes.
 */
const REUNION_TERMS_VERSION = '2026-08-02';

const REUNION_TERMS_TEXT =
	'This is deposit 1/2 — and used to reserve class time and banquet with Grandmaster Li Yujie. It is non-refundable.';

module.exports = { REUNION_TERMS_VERSION, REUNION_TERMS_TEXT };
