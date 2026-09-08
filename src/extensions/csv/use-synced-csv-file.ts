import type { Lix } from "@lix-js/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLix } from "@/lib/lix-react";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import {
	isMetadataObject,
	readCsvMetadata,
	type CsvMetadata,
} from "./csv-metadata";

type Options = {
	fileId: string;
	initialText: string;
	initialMetadata: unknown;
	reviewText: string | null;
	reviewing: boolean;
	readOnly: boolean;
	originKey: string;
};
type Pending = { text: string; metadata?: CsvMetadata };
type QueuedWrite = Pending & { writeContent: boolean };
const equalMetadata = (
	a: CsvMetadata | undefined,
	b: CsvMetadata | undefined,
) => JSON.stringify(a) === JSON.stringify(b);

/** One write queue owns CSV bytes and their optional column definitions. */
export function useSyncedCsvFile({
	fileId,
	initialText,
	initialMetadata,
	reviewText,
	reviewing,
	readOnly,
	originKey,
}: Options): {
	text: string;
	metadata: CsvMetadata | undefined;
	saveError: string | null;
	persist: (text: string, metadata?: CsvMetadata) => void;
} {
	const lix = useLix();
	const [text, setText] = useState(reviewText ?? initialText);
	const [metadata, setMetadata] = useState(() =>
		readCsvMetadata(initialMetadata),
	);
	const [saveError, setSaveError] = useState<string | null>(null);
	const local = useRef<Pending>({ text, metadata });
	const clean = useRef<Pending>({ text: initialText, metadata });
	const queued = useRef<QueuedWrite | null>(null);
	const running = useRef(false);
	const observationSkipped = useRef(false);
	const editSequence = useRef(0);
	const observationSequence = useRef(0);
	const reviewingRef = useRef(reviewing);
	reviewingRef.current = reviewing;
	const readOnlyRef = useRef(readOnly);
	readOnlyRef.current = readOnly;
	const blocked = useRef(reviewing || readOnly);
	blocked.current = reviewing || readOnly;
	const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
	const wasReviewing = useRef(false);

	const flush = useCallback(async () => {
		if (running.current || blocked.current) return;
		running.current = true;
		let failed = false;
		try {
			while (queued.current && !blocked.current) {
				const next = queued.current;
				queued.current = null;
				try {
					let storedText = next.text;
					if (next.metadata === undefined) {
						if (next.writeContent) {
							const result = await lix.execute(
								"UPDATE lix_file SET content = $1 WHERE id = $2",
								[new TextEncoder().encode(next.text), fileId],
								{ originKey },
							);
							if (result.rowsAffected === 0)
								throw new Error(
									"Could not save because the file no longer exists.",
								);
						} else storedText = clean.current.text;
					} else {
						storedText = await writeCsvMetadata(
							lix,
							fileId,
							next,
							next.writeContent,
							originKey,
						);
					}
					if (
						storedText !== next.text &&
						local.current.text === next.text &&
						queued.current === null
					) {
						local.current = { ...local.current, text: storedText };
						setText(storedText);
					}
					next.text = storedText;
					clean.current = {
						text: next.text,
						metadata: next.metadata ?? clean.current.metadata,
					};
					setSaveError(null);
				} catch (error) {
					failed = true;
					// Preserve a failed schema update even if a newer content-only edit arrived.
					const newer = queued.current as QueuedWrite | null;
					queued.current = newer
						? {
								text: newer.text,
								metadata: newer.metadata ?? next.metadata,
								writeContent: newer.writeContent || next.writeContent,
							}
						: next;
					setSaveError(
						error instanceof Error ? error.message : "Could not save CSV",
					);
					if (retry.current === null)
						retry.current = setTimeout(() => {
							retry.current = null;
							void flush();
						}, 2000);
					break;
				}
			}
		} finally {
			running.current = false;
			if (!failed && queued.current && !blocked.current) void flush();
			else if (!failed && observationSkipped.current && !blocked.current) {
				observationSkipped.current = false;
				const sequence = editSequence.current;
				const observation = observationSequence.current;
				void lix
					.execute(
						"SELECT content, lixcol_metadata FROM lix_file WHERE id = $1",
						[fileId],
					)
					.then((result) => {
						if (
							blocked.current ||
							running.current ||
							queued.current ||
							sequence !== editSequence.current ||
							observation !== observationSequence.current
						)
							return;
						const row = result.rows[0];
						if (!row) return;
						const observed = {
							text: decodeFileDataToText(row.content),
							metadata: readCsvMetadata(row.lixcol_metadata),
						};
						local.current = clean.current = observed;
						setText(observed.text);
						setMetadata(observed.metadata);
					})
					.catch(() => {
						observationSkipped.current = true;
					});
			}
		}
	}, [fileId, lix, originKey]);

	const persist = useCallback(
		(nextText: string, nextMetadata?: CsvMetadata) => {
			if (blocked.current) return;
			editSequence.current += 1;
			// Preserve the user's intent at edit time. A metadata-only edit must
			// not become a content write when an earlier save discovers new bytes.
			const writeContent =
				nextText !== local.current.text ||
				Boolean(queued.current?.writeContent);
			local.current = {
				text: nextText,
				metadata: nextMetadata ?? local.current.metadata,
			};
			setText(nextText);
			if (nextMetadata !== undefined) setMetadata(nextMetadata);
			queued.current = {
				writeContent,
				text: nextText,
				metadata: nextMetadata ?? queued.current?.metadata,
			};
			void flush();
		},
		[flush],
	);

	useEffect(() => {
		blocked.current = reviewingRef.current || readOnlyRef.current;
		return () => {
			// The closed view cannot accept new edits. Finish writes that the user
			// already made, even if review or a read-only state paused the queue.
			blocked.current = false;
			void flush();
		};
	}, [flush]);

	useEffect(() => {
		if (!reviewing && !readOnly) void flush();
	}, [reviewing, readOnly, flush]);

	useEffect(() => {
		let canceled = false;
		if (reviewing) {
			// Existing edits stay queued while review blocks new writes.
			if (reviewText !== null) setText(reviewText);
		}
		if (!reviewing && wasReviewing.current) {
			const sequence = editSequence.current;
			const observation = observationSequence.current;
			void lix
				.execute(
					"SELECT content, lixcol_metadata FROM lix_file WHERE id = $1",
					[fileId],
				)
				.then((result) => {
					const row = result.rows[0];
					if (
						!row ||
						canceled ||
						sequence !== editSequence.current ||
						observation !== observationSequence.current ||
						reviewingRef.current ||
						running.current ||
						queued.current
					)
						return;
					const next = {
						text: decodeFileDataToText(row.content),
						metadata: readCsvMetadata(row.lixcol_metadata),
					};
					local.current = clean.current = next;
					setText(next.text);
					setMetadata(next.metadata);
				})
				.catch((error) => {
					if (!canceled)
						setSaveError(
							error instanceof Error ? error.message : "Could not reload CSV",
						);
				});
		}
		wasReviewing.current = reviewing;
		return () => {
			canceled = true;
		};
	}, [fileId, lix, reviewing, reviewText]);

	useEffect(() => {
		const events = lix.observe(
			"SELECT content, lixcol_metadata FROM lix_file WHERE id = $1",
			[fileId],
		);
		let closed = false;
		void (async () => {
			try {
				for (;;) {
					if (closed) break;
					const event = await events.next();
					if (!event || closed) continue;
					const row = event.result.rows[0];
					if (!row) continue;
					observationSequence.current += 1;
					if (reviewingRef.current) continue;
					if (running.current || queued.current) {
						observationSkipped.current = true;
						continue;
					}
					const next = {
						text: decodeFileDataToText(row.content),
						metadata: readCsvMetadata(row.lixcol_metadata),
					};
					const changed =
						next.text !== local.current.text ||
						!equalMetadata(next.metadata, local.current.metadata);
					local.current = clean.current = next;
					if (changed) {
						setText(next.text);
						setMetadata(next.metadata);
					}
				}
			} catch (error) {
				if (!closed)
					setSaveError(
						error instanceof Error ? error.message : "Could not observe CSV",
					);
			}
		})();
		return () => {
			closed = true;
			events.close();
		};
	}, [fileId, lix]);

	return { text, metadata, saveError, persist };
}

/** Merge against a certified file revision without holding the shared SDK handle. */
async function writeCsvMetadata(
	lix: Lix,
	fileId: string,
	next: Pending,
	contentChanged: boolean,
	originKey: string,
): Promise<string> {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const snapshot = await lix.execute(
			"SELECT content, lixcol_metadata, lixcol_change_id FROM lix_file WHERE id = $1",
			[fileId],
		);
		const row = snapshot.rows[0];
		if (!row)
			throw new Error("Could not save because the file no longer exists.");
		const merged = {
			...(isMetadataObject(row.lixcol_metadata) ? row.lixcol_metadata : {}),
			atelier_csv: next.metadata!,
		};
		const result = contentChanged
			? await lix.execute(
					"UPDATE lix_file SET content = $1, lixcol_metadata = $2 WHERE id = $3 AND lixcol_change_id = $4",
					[
						new TextEncoder().encode(next.text),
						merged,
						fileId,
						row.lixcol_change_id as string,
					],
					{ originKey },
				)
			: await lix.execute(
					"UPDATE lix_file SET lixcol_metadata = $1 WHERE id = $2 AND lixcol_change_id = $3",
					[merged, fileId, row.lixcol_change_id as string],
					{ originKey },
				);
		if (result.rowsAffected === 1)
			return contentChanged ? next.text : decodeFileDataToText(row.content);
	}
	throw new Error(
		"The CSV changed repeatedly while saving. Retrying your edit…",
	);
}
