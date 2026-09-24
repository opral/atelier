import { createLucideIcon } from "lucide-react";

/*
 * The design's comment bubbles: the classic square bubble with a straight
 * tail. Lucide's `MessageSquare` has since taken a rounded tail.
 */
const BUBBLE = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

/** A comment count (N5). */
export const CommentBubble = createLucideIcon("comment-bubble", [
	["path", { d: BUBBLE, key: "bubble" }],
]);

/** The selection toolbar's Comment row (N1): the bubble with two lines. */
export const CommentBubbleText = createLucideIcon("comment-bubble-text", [
	["path", { d: BUBBLE, key: "bubble" }],
	["path", { d: "M8 9h8", key: "line-1" }],
	["path", { d: "M8 13h5", key: "line-2" }],
]);
