/**
 * The line drawn in the Tasks tab's "Draw dependency" mode (docs/tasks-tab.md):
 * from where the drag started to the pointer, with a label saying what a
 * release would do.  Fixed over the page and transparent to the pointer, so
 * the row under it can still be found.
 */
import { Box, Typography, useTheme } from '@mui/material';

export interface Point { x: number; y: number }

/** The label's distance from the pointer. */
const LABEL_GAP = 14;

export interface DependencyDrawLayerProps {
    from: Point;
    to: Point;
    /** E.g. "“Firmware” depends on “CAD”"; shown next to the pointer. */
    label: string;
    /** True over a task a release would link to (solid line, arrowhead). */
    onTarget: boolean;
}

export function DependencyDrawLayer({ from, to, label, onTarget }: DependencyDrawLayerProps) {
    const theme = useTheme();
    const color = onTarget ? theme.palette.primary.main : theme.palette.text.secondary;
    // The label stays on the screen: on the side of the pointer with more
    // room, wrapping when even that is too narrow (phones).
    const viewport = window.innerWidth;
    const labelPlace = to.x > viewport / 2
        ? { right: viewport - to.x + LABEL_GAP, maxWidth: to.x - LABEL_GAP - 8 }
        : { left: to.x + LABEL_GAP, maxWidth: viewport - to.x - LABEL_GAP - 8 };
    return (
        <Box data-testid="dependency-line" aria-hidden
            sx={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: theme.zIndex.tooltip }}>
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
                <defs>
                    <marker id="dependency-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                        markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                        <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                    </marker>
                </defs>
                <circle cx={from.x} cy={from.y} r={4} fill={color} />
                <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={color} strokeWidth={2}
                    strokeDasharray={onTarget ? undefined : '6 4'} markerEnd="url(#dependency-arrow)" />
            </svg>
            <Typography variant="caption" component="div"
                style={{ ...labelPlace, top: to.y + LABEL_GAP }}
                sx={{
                    position: 'absolute', px: 1, py: 0.25, borderRadius: 1, width: 'max-content',
                    bgcolor: onTarget ? 'primary.main' : 'background.paper', boxShadow: 3,
                    color: onTarget ? 'primary.contrastText' : 'text.secondary',
                }}>
                {label}
            </Typography>
        </Box>
    );
}
