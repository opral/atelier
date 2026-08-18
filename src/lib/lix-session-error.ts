const SESSION_GONE_CODE = "LIX_ERROR_PROTOCOL_SESSION_GONE";
const SESSION_CLOSED_CODE = "LIX_ERROR_CLOSED";
const SESSION_GONE_MESSAGE = "open a new client session";

/**
 * True when a Lix failure means the protocol client session is gone and a
 * new handshake is required. The JS SDK (`RemoteLixBinding.open`) and the
 * LixRay host (`openRepositoryLixSession`) own that handshake; Atelier can
 * only remount and ask the host to reopen.
 */
export function isRecoverableLixSessionError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = "code" in error ? error.code : undefined;
	if (code === SESSION_GONE_CODE || code === SESSION_CLOSED_CODE) {
		return true;
	}
	const status = "status" in error ? error.status : undefined;
	if (status === 410) return true;
	const message = error.message.toLowerCase();
	return (
		message.includes("protocol session is unknown") ||
		message.includes(SESSION_GONE_MESSAGE)
	);
}

export function createLixProtocolSessionGoneError(
	message = "the Lix protocol session is unknown, expired, or closed; open a new client session",
): Error & { code: string; status: number } {
	return Object.assign(new Error(message), {
		name: "LixError",
		code: SESSION_GONE_CODE,
		status: 410,
	});
}
