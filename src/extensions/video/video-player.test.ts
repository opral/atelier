import { describe, expect, test, vi } from "vitest";
import {
	createVideoPlayer,
	formatVideoFileSize,
	formatVideoTimecode,
	videoMimeTypeFromPath,
} from "./video-player";

describe("videoMimeTypeFromPath", () => {
	test.each([
		["/assets/kickoff.mp4", "video/mp4"],
		["/assets/Screen-Rec.MOV", "video/quicktime"],
		["/assets/clip.webm", "video/webm"],
	])("maps %s to %s", (path, mimeType) => {
		expect(videoMimeTypeFromPath(path)).toBe(mimeType);
	});

	test("rejects paths outside the video extension", () => {
		expect(videoMimeTypeFromPath("/notes/readme.md")).toBeUndefined();
		expect(videoMimeTypeFromPath("/assets/photo.png")).toBeUndefined();
	});
});

describe("formatVideoTimecode", () => {
	test.each([
		[0, "0:00"],
		[9, "0:09"],
		[154, "2:34"],
		[3725, "1:02:05"],
	])("formats %s seconds as %s", (seconds, expected) => {
		expect(formatVideoTimecode(seconds)).toBe(expected);
	});

	test("treats invalid input as zero", () => {
		expect(formatVideoTimecode(Number.NaN)).toBe("0:00");
		expect(formatVideoTimecode(Number.POSITIVE_INFINITY)).toBe("0:00");
		expect(formatVideoTimecode(-4)).toBe("0:00");
	});
});

describe("formatVideoFileSize", () => {
	test.each([
		[512, "512 B"],
		[48 * 1024, "48 KB"],
		[50_536_120, "48.2 MB"],
		[3.4 * 1024 * 1024 * 1024, "3.4 GB"],
	])("formats %s bytes as %s", (bytes, expected) => {
		expect(formatVideoFileSize(bytes)).toBe(expected);
	});

	test("returns an empty label for invalid sizes", () => {
		expect(formatVideoFileSize(Number.NaN)).toBe("");
		expect(formatVideoFileSize(-1)).toBe("");
	});
});

describe("createVideoPlayer (standalone)", () => {
	test("renders the full glass chrome with file chip and controls", () => {
		const player = createVideoPlayer({
			variant: "standalone",
			fileName: "kickoff.mp4",
			fileSizeBytes: 50_536_120,
		});

		const root = player.element;
		expect(root.dataset.variant).toBe("standalone");
		expect(root.tabIndex).toBe(0);
		expect(
			root.querySelector(".atelier-video-chip--file")?.textContent,
		).toContain("kickoff.mp4");
		expect(
			root.querySelector(".atelier-video-chip--file")?.textContent,
		).toContain("read-only");
		expect(root.querySelector(".atelier-video-track-knob")).not.toBeNull();
		expect(root.querySelector(".atelier-video-rate")).not.toBeNull();
		expect(root.querySelector(".atelier-video-mute")).not.toBeNull();
		expect(
			root.querySelector<HTMLButtonElement>(".atelier-video-fullscreen"),
		).not.toBeNull();
		expect(root.querySelector(".atelier-video-puck")).toHaveAccessibleName(
			"Play",
		);
		player.destroy();
	});

	test("fills the specs chip from metadata and reports it once", () => {
		const onMetadata = vi.fn();
		const player = createVideoPlayer({
			variant: "standalone",
			fileName: "kickoff.mp4",
			fileSizeBytes: 50_536_120,
			onMetadata,
		});
		player.setSource("blob:video");
		Object.defineProperties(player.video, {
			duration: { configurable: true, value: 154 },
			videoWidth: { configurable: true, value: 1920 },
			videoHeight: { configurable: true, value: 1080 },
		});
		player.video.dispatchEvent(new Event("loadedmetadata"));
		player.video.dispatchEvent(new Event("loadedmetadata"));

		const specs = player.element.querySelector(".atelier-video-chip--specs");
		expect(specs?.textContent).toBe("2:34 · 1920×1080 · 48.2 MB");
		expect(
			player.element.querySelector(".atelier-video-timecode")?.textContent,
		).toBe("0:00 / 2:34");
		expect(onMetadata).toHaveBeenCalledOnce();
		expect(onMetadata).toHaveBeenCalledWith({
			duration: 154,
			width: 1920,
			height: 1080,
		});
		player.destroy();
	});

	test("cycles playback rate and toggles mute state", () => {
		const player = createVideoPlayer({ variant: "standalone" });
		const rate = player.element.querySelector<HTMLButtonElement>(
			".atelier-video-rate",
		)!;
		rate.click();
		expect(rate.textContent).toBe("1.25×");
		expect(player.video.playbackRate).toBe(1.25);
		rate.click();
		rate.click();
		rate.click();
		expect(rate.textContent).toBe("1×");

		const mute = player.element.querySelector<HTMLButtonElement>(
			".atelier-video-mute",
		)!;
		mute.click();
		expect(player.video.muted).toBe(true);
		expect(player.element.dataset.muted).toBe("true");
		expect(mute).toHaveAccessibleName("Unmute");
		mute.click();
		expect(player.video.muted).toBe(false);
		player.destroy();
	});

	test("shows the error state when the source cannot be decoded", () => {
		const onError = vi.fn();
		const player = createVideoPlayer({ variant: "standalone", onError });
		player.setSource("blob:broken");
		player.video.dispatchEvent(new Event("error"));

		expect(player.element.dataset.videoState).toBe("error");
		expect(
			player.element.querySelector<HTMLElement>(".atelier-video-error")?.hidden,
		).toBe(false);
		expect(onError).toHaveBeenCalledOnce();

		// A new source clears the error state.
		player.setSource("blob:fixed");
		expect(player.element.dataset.videoState).toBeUndefined();
		player.destroy();
	});

	test("destroy detaches the element and releases the source", () => {
		const parent = document.createElement("div");
		const player = createVideoPlayer({ variant: "standalone" });
		parent.append(player.element);
		player.setSource("blob:video");
		player.destroy();

		expect(parent.childElementCount).toBe(0);
		expect(player.video.getAttribute("src")).toBeNull();
	});
});

describe("createVideoPlayer (embed)", () => {
	test("renders the compact pill without standalone chrome", () => {
		const player = createVideoPlayer({ variant: "embed" });
		const root = player.element;
		expect(root.dataset.variant).toBe("embed");
		expect(root.tabIndex).not.toBe(0);
		expect(root.querySelector(".atelier-video-chip--file")).toBeNull();
		expect(root.querySelector(".atelier-video-chip--specs")).toBeNull();
		expect(root.querySelector(".atelier-video-track-knob")).toBeNull();
		expect(root.querySelector(".atelier-video-rate")).toBeNull();
		expect(root.querySelector(".atelier-video-mute")).toBeNull();
		expect(root.querySelector(".atelier-video-toggle")).not.toBeNull();
		expect(root.querySelector(".atelier-video-fullscreen")).not.toBeNull();
		expect(root.querySelector(".atelier-video-puck")).not.toBeNull();
		player.destroy();
	});
});
