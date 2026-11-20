// jsdom has no layout; ProseMirror's cursor, Crepe's widgets and CodeMirror only need empty rectangles.
// Import this file for its effect, before the code under test runs.
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => rect as DOMRect
document.elementFromPoint = () => null

export {}
