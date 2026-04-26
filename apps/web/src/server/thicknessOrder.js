const THICKNESS_ORDER = new Map([
  ["5 MM", 1],
  ["6 MM", 2],
  ["1 CM", 3],
  ["12 MM", 4],
  ["2 CM", 5],
  ["3 CM", 6],
]);

export function normalizeThicknessLabel(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

export function compareThicknessLabels(left, right) {
  const normalizedLeft = normalizeThicknessLabel(left);
  const normalizedRight = normalizeThicknessLabel(right);
  const leftRank = THICKNESS_ORDER.get(normalizedLeft);
  const rightRank = THICKNESS_ORDER.get(normalizedRight);

  if (leftRank !== undefined || rightRank !== undefined) {
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }

  return normalizedLeft.localeCompare(normalizedRight);
}

export function uniqueSortedThicknesses(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))]
    .sort(compareThicknessLabels);
}
