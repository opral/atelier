import "@testing-library/jest-dom";

// jsdom has no layout, so it ships no hit testing. ProseMirror asks for the
// element under the pointer on every mousedown; without this the call threw
// past the test that caused it and surfaced as an unhandled error for the
// whole run.
if (typeof Document !== "undefined" && !Document.prototype.elementFromPoint) {
	Document.prototype.elementFromPoint = () => null;
	Document.prototype.elementsFromPoint = () => [];
}
