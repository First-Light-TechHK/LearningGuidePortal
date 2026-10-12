/** Insert three exhibits after evenly spaced paragraphs, preserving all rich HTML. */
export function textExhibitPositions(paragraphCount: number, exhibitCount = 3): number[] {
  if (paragraphCount < 1) return Array(exhibitCount).fill(0);
  const interior = Math.max(1, paragraphCount - 1);
  return Array.from({ length: exhibitCount }, (_, index) => Math.min(interior, 1 + Math.floor(index * interior / exhibitCount)));
}
