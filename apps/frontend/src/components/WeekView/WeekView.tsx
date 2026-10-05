import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { DayColumn, BUCKET_COLUMN_WIDTH } from '../DayColumn/DayColumn.tsx';
import { TimeScale, TIME_SCALE_WIDTH } from '../TimeScale/TimeScale.tsx';
import type { ViewTask, TaskActions, ActiveDrag } from '../WeekViewTask/WeekViewTask.tsx';
import { splitTaskAcrossDays } from '../../utils/taskSplitter.ts';
import type { BucketZone, DayZone } from '../../utils/planToWeek.ts';
import { zonesForDay } from '../../utils/planToWeek.ts';
import { minutesToPixels } from '../../utils/weekDrag.ts';
import { applyDragOverlay } from '../../utils/dragOverlay.ts';

const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Helper to get Monday of the current week (assuming Mon start)
const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(date.setDate(diff));
}

const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

const ZOOM_STEP = 1.15;
const MAX_ZOOM = 6;
const FALLBACK_HEIGHT = 720;
// Pixels per wheel step for wheels that count in lines / pages (deltaMode).
const LINE_PX = 16;
// The opening time frame starts this far below the day headers, so the label
// at its start (centered on its line) is not cut off.
const FRAME_MARGIN = 8;
// Below this width the week scrolls sideways.  Header and grid rows share it,
// so their columns line up; the time scale takes its width from the days, so
// the week needs no more room than before it had one.
const ROW_MIN_WIDTH = 1400;
const DAY_MIN_WIDTH = (ROW_MIN_WIDTH - TIME_SCALE_WIDTH) / 7;

interface WeekViewProps {
    tasks: ViewTask[];
    initialDate?: Date;
    zones?: BucketZone[];
    actions?: TaskActions;
    onZoneClick?: (zone: DayZone) => void;
    onZoneChange?: (zone: DayZone, start: Date, durationMinutes: number) => void;
    onCreateTask?: (start: Date, duration: number) => void;
    onTaskEdit?: (taskId: string) => void;
    onTaskChange?: (taskId: string, start: Date, durationMinutes: number) => void;
    onTaskDragChange?: (drag: ActiveDrag | null) => void;
    /** Live drag state; the moved appointment is rendered as a floating card. */
    activeDrag?: ActiveDrag | null;
    /** The time frame the view opens on (the user's usual work hours, minutes
     *  after midnight): zoomed to fill the visible height, scrolled to it. */
    viewRange?: { startMinutes: number; endMinutes: number };
}

export const WeekView: React.FC<WeekViewProps> = ({
    tasks, initialDate = new Date(), zones = [], actions,
    onZoneClick, onZoneChange, onCreateTask, onTaskEdit, onTaskChange,
    onTaskDragChange, activeDrag, viewRange,
}) => {
    const [currentDate, setCurrentDate] = useState(initialDate);
    const scrollRef = useRef<HTMLDivElement>(null);
    // The height at which a full day fits the viewport with no scrolling.
    const [fitHeight, setFitHeight] = useState(FALLBACK_HEIGHT);
    // 1 = fit the whole day; > 1 = zoomed in (day taller than the viewport).
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);
    const gridRef = useRef<HTMLDivElement>(null);
    // The day headers stick to the top of the scroll area.
    const headerRef = useRef<HTMLDivElement>(null);
    // Scroll position a zoom step wants, applied once the grid has been
    // rendered at that zoom (earlier, the browser would clamp it to the old
    // height).
    const pendingScroll = useRef<{ top: number; zoom: number } | null>(null);
    // Set once the user zooms or scrolls with the wheel: the view is theirs,
    // a resize or a changed time frame no longer refits it.
    const adjusted = useRef(false);

    const columnHeight = Math.round(fitHeight * zoom);

    // Measure the scroll viewport below the day headers, so the default zoom
    // shows the full day.
    useLayoutEffect(() => {
        const measure = () => {
            const scroll = scrollRef.current;
            if (!scroll) return;
            const height = scroll.clientHeight - (headerRef.current?.offsetHeight ?? 0);
            if (height > 0) setFitHeight(height);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (scrollRef.current) observer.observe(scrollRef.current);
        if (headerRef.current) observer.observe(headerRef.current);
        return () => observer.disconnect();
    }, []);

    // Open on the time frame from the settings: zoom so it fills the visible
    // height (at most MAX_ZOOM), its start just below the headers.  Again on a
    // resize or a changed frame, until the user has zoomed or wheel-scrolled.
    const rangeStart = viewRange?.startMinutes;
    const rangeEnd = viewRange?.endMinutes;
    useLayoutEffect(() => {
        if (adjusted.current || rangeStart === undefined || rangeEnd === undefined || rangeEnd <= rangeStart) return;
        const filled = ((fitHeight - FRAME_MARGIN) / (rangeEnd - rangeStart)) * 1440; // day height
        const next = Math.min(MAX_ZOOM, Math.max(1, filled / fitHeight));
        const height = Math.round(fitHeight * next);
        zoomRef.current = next;
        pendingScroll.current = { top: Math.max(0, (rangeStart / 1440) * height - FRAME_MARGIN), zoom: next };
        setZoom(next);
    }, [fitHeight, rangeStart, rangeEnd]);

    // Mouse wheel adjusts the zoom factor, anchored on the cursor; Ctrl+wheel
    // scrolls.  Attached natively so the page scroll (and with Ctrl the
    // browser's page zoom) can be prevented; Shift+wheel stays native.
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        const onWheel = (event: WheelEvent) => {
            if (event.shiftKey) return; // escape hatch: native scroll
            event.preventDefault();
            adjusted.current = true;
            if (event.ctrlKey) {
                const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX
                    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? container.clientHeight : 1);
                if (pendingScroll.current) pendingScroll.current.top += delta; // a zoom not yet rendered
                else container.scrollTop += delta;
                return;
            }
            const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            const prev = zoomRef.current;
            const next = Math.min(MAX_ZOOM, Math.max(1, prev * factor));
            if (next === prev) return;
            zoomRef.current = next;
            // Keep the time under the cursor stationary while zooming (the
            // grid starts below the sticky day headers).  Several wheel events
            // can arrive before React renders: continue from the scroll
            // position the previous one asked for.
            const rect = container.getBoundingClientRect();
            const pointerY = event.clientY - rect.top;
            const headerHeight = headerRef.current?.offsetHeight ?? 0;
            const scrollTop = pendingScroll.current?.top ?? container.scrollTop;
            const gridY = scrollTop + pointerY - headerHeight;
            pendingScroll.current = { top: gridY * (next / prev) - pointerY + headerHeight, zoom: next };
            setZoom(next);
        };
        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, []);

    // Apply a pending scroll once the grid has been rendered at its zoom
    // (after the render, before paint).
    useLayoutEffect(() => {
        const container = scrollRef.current;
        const pending = pendingScroll.current;
        if (!container || !pending || pending.zoom !== zoom) return;
        container.scrollTop = pending.top;
        pendingScroll.current = null;
    });

    const weekStart = getMonday(currentDate);
    const weekEnd = addDays(weekStart, 6);

    const handlePrevWeek = () => setCurrentDate(addDays(currentDate, -7));
    const handleNextWeek = () => setCurrentDate(addDays(currentDate, 7));

    const days = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

    // Map a pointer's horizontal position to the day column under it, so a task
    // or bucket can be dragged across days (the time comes from the vertical
    // drag; this only decides which day it lands on).  Called from drag
    // handlers, never during render.
    const resolveDay = (clientX: number): Date | null => {
        const el = gridRef.current;
        if (!el || days.length !== 7) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return null;
        let index = Math.floor((clientX - rect.left) / (rect.width / 7));
        index = Math.max(0, Math.min(6, index));
        const day = new Date(days[index]);
        day.setHours(0, 0, 0, 0);
        return day;
    };

    // Which half of its day column the pointer is in (for overlap shrinking).
    const resolveCursorHalf = (clientX: number): 'left' | 'right' => {
        const el = gridRef.current;
        if (!el) return 'left';
        const rect = el.getBoundingClientRect();
        if (rect.width === 0) return 'left';
        const columnWidth = rect.width / 7;
        const offsetInColumn = (clientX - rect.left) % columnWidth;
        return offsetInColumn < columnWidth / 2 ? 'left' : 'right';
    };

    const formatRange = (start: Date, end: Date) => {
        const formatDateSimple = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.`;
        const formatDateFull = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
        return `${formatDateSimple(start)} - ${formatDateFull(end)}`;
    };

    const allSegments = applyDragOverlay(tasks, activeDrag ?? null).flatMap(splitTaskAcrossDays);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, width: '100%', overflow: 'hidden' }}>
            {/* Navigation Header */}
            <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                p: 1, borderBottom: '1px solid #333', backgroundColor: '#1e1e1e', zIndex: 20, flexShrink: 0,
            }}>
                <Button onClick={handlePrevWeek} variant="contained" sx={{ minWidth: '40px' }}>&lt;</Button>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    {formatRange(weekStart, weekEnd)}
                </Typography>
                <Button onClick={handleNextWeek} variant="contained" sx={{ minWidth: '40px' }}>&gt;</Button>
            </Box>

            {/* Week (scrollable; wheel zooms) */}
            <Box ref={scrollRef} data-testid="week-scroll" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {/* Days header row: sticks to the top and scrolls sideways
                    with the grid, so the headers stay above their columns. */}
                <Box ref={headerRef} sx={{
                    display: 'flex', minWidth: ROW_MIN_WIDTH, position: 'sticky', top: 0, zIndex: 3,
                    borderBottom: '1px solid #333', backgroundColor: '#1e1e1e',
                }}>
                    <Box data-testid="time-scale-corner" sx={{
                        position: 'sticky', left: 0, zIndex: 1, width: TIME_SCALE_WIDTH, flexShrink: 0,
                        backgroundColor: '#1e1e1e', borderRight: '1px solid #333',
                    }} />
                    {days.map((day, index) => (
                        <Box key={index} sx={{ flex: 1, minWidth: DAY_MIN_WIDTH, p: 1, textAlign: 'center', borderRight: index < 6 ? '1px solid #333' : 'none' }}>
                            <Typography variant="subtitle2" sx={{ color: '#aaa', fontWeight: 'bold' }}>
                                {day.toLocaleDateString('de-DE', { weekday: 'short' }).toUpperCase()}
                            </Typography>
                            <Typography variant="h5" sx={{ fontWeight: 'normal' }}>
                                {day.getDate().toString().padStart(2, '0')}
                            </Typography>
                        </Box>
                    ))}
                </Box>

                <Box sx={{ display: 'flex', minWidth: ROW_MIN_WIDTH }}>
                    <TimeScale columnHeight={columnHeight} />
                    {/* The grid isolates its layers, so cards never paint over the
                        sticky time scale or headers. */}
                    <Box ref={gridRef} data-testid="week-grid" data-column-height={columnHeight} sx={{ position: 'relative', display: 'flex', flex: 1, height: columnHeight, isolation: 'isolate' }}>
                        {/* A moved appointment is rendered as a floating card (same
                            colour + size, not a ghost) that follows the pointer to
                            the target day + time so it can be placed precisely. */}
                        {activeDrag && activeDrag.mode === 'move' && (() => {
                            const index = days.findIndex(day => sameDay(day, activeDrag.start));
                            if (index < 0) return null;
                            const startMin = activeDrag.start.getHours() * 60 + activeDrag.start.getMinutes();
                            return (
                                <Box
                                    data-testid="drag-layer"
                                    sx={{
                                        position: 'absolute',
                                        // Stay inside the task column (skip the bucket column),
                                        // like a real appointment card.
                                        left: `calc(${(index * 100) / 7}% + ${BUCKET_COLUMN_WIDTH}px)`,
                                        width: `calc(${100 / 7}% - ${BUCKET_COLUMN_WIDTH}px)`,
                                        top: `${minutesToPixels(startMin, columnHeight)}px`,
                                        height: `${minutesToPixels(activeDrag.durationMinutes, columnHeight)}px`,
                                        backgroundColor: activeDrag.color,
                                        border: '1px solid rgba(255, 255, 255, 0.6)',
                                        borderRadius: '4px',
                                        boxSizing: 'border-box',
                                        pointerEvents: 'none',
                                        zIndex: 40,
                                        overflow: 'hidden',
                                        boxShadow: 3,
                                    }}
                                >
                                    <Typography variant="caption" sx={{ px: 0.5, fontWeight: 'bold' }}>
                                        {activeDrag.title}
                                    </Typography>
                                </Box>
                            );
                        })()}
                        {days.map((day, index) => {
                            const dayTasks = allSegments.filter(task => {
                                const taskDate = new Date(task.startTime);
                                return taskDate.getDate() === day.getDate()
                                    && taskDate.getMonth() === day.getMonth()
                                    && taskDate.getFullYear() === day.getFullYear();
                            });

                            return (
                                <Box key={index} sx={{ flex: 1, minWidth: DAY_MIN_WIDTH, borderRight: index < 6 ? '1px solid #333' : 'none' }}>
                                    <DayColumn
                                        date={day}
                                        tasks={dayTasks}
                                        currentTime={new Date()}
                                        onCreateTask={(start, duration) => onCreateTask?.(start, duration)}
                                        columnHeight={columnHeight}
                                        zones={zonesForDay(zones, day)}
                                        actions={actions}
                                        onZoneClick={onZoneClick}
                                        onZoneChange={onZoneChange}
                                        onTaskEdit={onTaskEdit}
                                        onTaskChange={onTaskChange}
                                        resolveDay={resolveDay}
                                        resolveCursorHalf={resolveCursorHalf}
                                        onTaskDragChange={onTaskDragChange}
                                    />
                                </Box>
                            );
                        })}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};
