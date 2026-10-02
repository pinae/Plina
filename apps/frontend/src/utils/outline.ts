/**
 * UI-6: the outline row model shared by the split editor and (UI-7) the
 * outline view. Rows are a flat list with a depth, like in an outliner; a
 * row's subtree is the block of following rows that are deeper.
 */
import { parseQuickAdd, type QuickAddContext } from './quickAdd.ts';

export interface OutlineRow {
    /** Stable client key (React key, focus). */
    key: string;
    /** Existing task; absent for new rows. */
    id?: string;
    header: string;
    /** Explicit estimate in minutes; null = ghost (share of the rest). */
    minutes: number | null;
    /** What the estimate cell shows while editing (e.g. "1,5" or "90m"). */
    durationText?: string;
    depth: number;
    /** Completed task: shown, kept, not editable. */
    done?: boolean;
    tagIds?: string[];
    newTags?: string[];
    priority?: number;
    /** ISO date-time. */
    deadline?: string;
    /** Row-level problem, e.g. an unknown token in the header. */
    error?: string;
}

let counter = 0;
export const newRow = (depth: number, header = ''): OutlineRow =>
    ({ key: `row-${Date.now().toString(36)}-${counter++}`, header, minutes: null, depth });

/** Index after the row's subtree. */
export function subtreeEnd(rows: OutlineRow[], index: number): number {
    let end = index + 1;
    while (end < rows.length && rows[end].depth > rows[index].depth) end++;
    return end;
}

export const hasChildren = (rows: OutlineRow[], index: number) =>
    index + 1 < rows.length && rows[index + 1].depth > rows[index].depth;

/** A new sibling after the row (and its subtree). */
export function insertAfter(rows: OutlineRow[], index: number, row?: OutlineRow): { rows: OutlineRow[]; index: number } {
    const at = index < 0 ? rows.length : subtreeEnd(rows, index);
    const inserted = row ?? newRow(index < 0 ? 0 : rows[index].depth);
    return { rows: [...rows.slice(0, at), inserted, ...rows.slice(at)], index: at };
}

function shiftBlock(rows: OutlineRow[], index: number, delta: number): OutlineRow[] {
    const end = subtreeEnd(rows, index);
    return rows.map((row, i) => (i >= index && i < end ? { ...row, depth: row.depth + delta } : row));
}

/** Tab: become a sub-part of the row above (at most one level deeper). */
export function indent(rows: OutlineRow[], index: number): OutlineRow[] {
    if (index <= 0 || rows[index - 1].depth < rows[index].depth) return rows;
    return shiftBlock(rows, index, 1);
}

/** Shift+Tab: one level up. */
export function outdent(rows: OutlineRow[], index: number): OutlineRow[] {
    if (rows[index].depth === 0) return rows;
    return shiftBlock(rows, index, -1);
}

/** Alt+↑/↓: swap the row's block with the neighbouring sibling block. */
export function move(rows: OutlineRow[], index: number, direction: -1 | 1): { rows: OutlineRow[]; index: number } {
    const depth = rows[index].depth;
    const end = subtreeEnd(rows, index);
    if (direction === 1) {
        if (end >= rows.length || rows[end].depth !== depth) return { rows, index };
        const nextEnd = subtreeEnd(rows, end);
        const moved = [...rows.slice(0, index), ...rows.slice(end, nextEnd), ...rows.slice(index, end), ...rows.slice(nextEnd)];
        return { rows: moved, index: index + (nextEnd - end) };
    }
    let previous = index - 1;
    while (previous >= 0 && rows[previous].depth > depth) previous--;
    if (previous < 0 || rows[previous].depth !== depth) return { rows, index };
    const moved = [...rows.slice(0, previous), ...rows.slice(index, end), ...rows.slice(previous, index), ...rows.slice(end)];
    return { rows: moved, index: previous };
}

/** Backspace in an empty row; a row with sub-parts is never removed. */
export function removeAt(rows: OutlineRow[], index: number): OutlineRow[] {
    if (hasChildren(rows, index)) return rows;
    return [...rows.slice(0, index), ...rows.slice(index + 1)];
}

export interface OutlineNode {
    row: OutlineRow;
    index: number;
    children: OutlineNode[];
}

export function toTree(rows: OutlineRow[]): OutlineNode[] {
    const roots: OutlineNode[] = [];
    const stack: OutlineNode[] = [];
    rows.forEach((row, index) => {
        const node: OutlineNode = { row, index, children: [] };
        while (stack.length > 0 && stack[stack.length - 1].row.depth >= row.depth) stack.pop();
        (stack.length > 0 ? stack[stack.length - 1].children : roots).push(node);
        stack.push(node);
    });
    return roots;
}

const BULLET_RE = /^(?:[-*•]|\d+[.)])\s+/;

/** Pasted lines → rows: indentation (2 spaces or a tab per level) nests,
 *  bullets and numbering are stripped, empty lines are skipped. */
export function rowsFromText(text: string, baseDepth: number): OutlineRow[] {
    const rows: OutlineRow[] = [];
    const levels: number[] = [];
    for (const line of text.split(/\r?\n/)) {
        const header = line.trim().replace(BULLET_RE, '').trim();
        if (!header) continue;
        const indentWidth = line.match(/^[ \t]*/)![0].replace(/\t/g, '  ').length;
        while (levels.length > 0 && levels[levels.length - 1] >= indentWidth) levels.pop();
        const depth = Math.min(levels.length, rows.length ? rows[rows.length - 1].depth - baseDepth + 1 : 0);
        levels.push(indentWidth);
        rows.push(newRow(baseDepth + depth, header));
    }
    return rows;
}

/** Estimate cell text for minutes: "3h" or "2:15" (both parse back). */
export const minutesToText = (minutes: number) =>
    minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** "CAD 3h #maker" → header "CAD", estimate 3h, tag maker (all quick-add
 *  tokens work). Unknown tokens keep the text and set ``error``. */
export function commitRowTokens(row: OutlineRow, context: QuickAddContext): OutlineRow {
    const parsed = parseQuickAdd(row.header, context);
    if (parsed.tokens.length === 0) return row.error ? { ...row, error: undefined } : row;
    if (parsed.tokens.some(t => t.kind === 'project') || row.header.split(/\s+/).some(w => /^\+\S/.test(w))) {
        return { ...row, error: 'A part can’t move to another project here — use the task dialog for that.' };
    }
    if (parsed.errors.length > 0) return { ...row, error: parsed.errors[0] };
    return {
        ...row,
        header: parsed.header,
        error: undefined,
        ...(parsed.durationMinutes !== null
            ? { minutes: parsed.durationMinutes, durationText: minutesToText(parsed.durationMinutes) } : {}),
        ...(parsed.tags.existing.length ? { tagIds: [...new Set([...(row.tagIds ?? []), ...parsed.tags.existing])] } : {}),
        ...(parsed.tags.new.length ? { newTags: [...new Set([...(row.newTags ?? []), ...parsed.tags.new])] } : {}),
        ...(parsed.priority !== null ? { priority: parsed.priority } : {}),
        ...(parsed.deadline ? { deadline: parsed.deadline.toISOString() } : {}),
    };
}
