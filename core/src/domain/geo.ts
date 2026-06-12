/**
 * Coarse location grid. Cells are 0.01° squares (~1.1 km at the equator) —
 * coarse enough to dispatch by, never precise enough to identify a door.
 * Cell ids carry integer row/col so no decimal coordinate ever appears in
 * a payload built from them.
 */

export interface GridCell {
  readonly row: number;
  readonly col: number;
}

export function toCell(lat: number, lng: number): GridCell {
  return { row: Math.floor(lat * 100), col: Math.floor(lng * 100) };
}

export function cellId(cell: GridCell): string {
  return `cell:${cell.row}:${cell.col}`;
}

export function parseCellId(id: string): GridCell {
  const parts = id.split(':');
  if (parts.length !== 3 || parts[0] !== 'cell') {
    throw new Error(`malformed cell id: ${id}`);
  }
  const row = Number(parts[1]);
  const col = Number(parts[2]);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    throw new Error(`malformed cell id: ${id}`);
  }
  return { row, col };
}

/** Chebyshev distance in cells — deterministic and explainable. */
export function cellDistance(a: GridCell, b: GridCell): number {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}
