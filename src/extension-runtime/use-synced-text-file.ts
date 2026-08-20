import { useCallback, useEffect, useRef, useState } from "react";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { useLix } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";

type SyncedTextFileOptions = {
	readonly fileId: string;
	readonly initialText: string;
	readonly reviewText: string | null;
	readonly reviewing: boolean;
	readonly readOnly: boolean;
	readonly originKey: string;
};

/**
 * Owns the local-write/remote-observation state machine shared by serialized
 * text editors. A pending local edit wins until its write drains; otherwise an
 * observed Lix snapshot is authoritative.
 */
export function useSyncedTextFile({
	fileId,
	initialText,
	reviewText,
	reviewing,
	readOnly,
	originKey,
}: SyncedTextFileOptions): {
	readonly text: string;
	readonly saveError: string | null;
	readonly persist: (text: string) => void;
} {
	const lix = useLix();
	const [text, setText] = useState(reviewText ?? initialText);
	const localTextRef = useRef(text);
	const lastCleanTextRef = useRef(initialText);
	const persistenceRunningRef = useRef(false);
	const queuedTextRef = useRef<string | null>(null);
	const reviewingRef = useRef(reviewing);
	const wasReviewingRef = useRef(false);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		reviewingRef.current = reviewing;
		if (reviewing && reviewText !== null) {
			queuedTextRef.current = null;
			localTextRef.current = reviewText;
			setText(reviewText);
		}
		if (!reviewing && wasReviewingRef.current) {
			void qb(lix)
				.selectFrom("lix_file")
				.select("content")
				.where("id", "=", fileId)
				.executeTakeFirst()
				.then((row) => {
					if (!row || reviewingRef.current) return;
					const nextText = decodeFileDataToText(row.content);
					lastCleanTextRef.current = nextText;
					localTextRef.current = nextText;
					setText(nextText);
				})
				.catch((error) => {
					if (!reviewingRef.current) {
						setSaveError(
							error instanceof Error
								? error.message
								: "Could not reload file after review",
						);
					}
				});
		}
		wasReviewingRef.current = reviewing;
	}, [fileId, lix, reviewText, reviewing]);

	const flushPersistence = useCallback(async () => {
		if (persistenceRunningRef.current || reviewingRef.current) return;
		persistenceRunningRef.current = true;
		try {
			while (queuedTextRef.current !== null && !reviewingRef.current) {
				const nextText = queuedTextRef.current;
				queuedTextRef.current = null;
				if (nextText === lastCleanTextRef.current) continue;
				try {
					await lix.execute(
						"UPDATE lix_file SET content = $1 WHERE id = $2",
						[new TextEncoder().encode(nextText), fileId],
						{ originKey },
					);
					lastCleanTextRef.current = nextText;
					setSaveError(null);
				} catch (error) {
					setSaveError(
						error instanceof Error ? error.message : "Could not save file",
					);
					// Keep a transient storage failure from leaving an editor ahead of
					// the durable file forever. A newer edit can still retry immediately.
					if (retryTimerRef.current === null) {
						retryTimerRef.current = setTimeout(() => {
							retryTimerRef.current = null;
							if (
								queuedTextRef.current === null &&
								localTextRef.current !== lastCleanTextRef.current
							) {
								queuedTextRef.current = localTextRef.current;
							}
							void flushPersistence();
						}, 2000);
					}
					break;
				}
			}
		} finally {
			persistenceRunningRef.current = false;
			if (queuedTextRef.current !== null) void flushPersistence();
		}
	}, [fileId, lix, originKey]);

	const persist = useCallback(
		(nextText: string) => {
			if (reviewingRef.current || readOnly) return;
			localTextRef.current = nextText;
			queuedTextRef.current = nextText;
			void flushPersistence();
		},
		[flushPersistence, readOnly],
	);

	useEffect(() => {
		const events = lix.observe("SELECT content FROM lix_file WHERE id = $1", [
			fileId,
		]);
		let closed = false;
		const reconcile = (data: unknown) => {
			if (closed) return;
			const nextText = decodeFileDataToText(data);
			if (nextText === localTextRef.current) {
				lastCleanTextRef.current = nextText;
				return;
			}
			if (reviewingRef.current) return;
			// A queued or running local edit wins until its durable write completes.
			if (
				persistenceRunningRef.current ||
				queuedTextRef.current !== null ||
				localTextRef.current !== lastCleanTextRef.current
			)
				return;
			lastCleanTextRef.current = nextText;
			localTextRef.current = nextText;
			setText(nextText);
		};
		void (async () => {
			try {
				for (;;) {
					if (closed) break;
					const event = await events.next();
					if (!event || closed) continue;
					const row = event.result.rows[0];
					if (row) reconcile(row.get("content"));
				}
			} catch (error) {
				if (!closed)
					setSaveError(
						error instanceof Error ? error.message : "Could not observe file",
					);
			}
		})();
		return () => {
			closed = true;
			events.close();
			// Do not discard an already serialized edit while its preceding write
			// is in flight. The detached flush drains it after the view closes.
		};
	}, [fileId, lix]);

	return { text, saveError, persist };
}
