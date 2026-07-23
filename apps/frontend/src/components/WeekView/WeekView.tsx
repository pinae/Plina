import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { DayColumn, BUCKET_COLUMN_WIDTH } from '../DayColumn/DayColumn.tsx';
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
}

export const WeekView: React.FC<WeekViewProps> = ({
    tasks, initialDate = new Date(), zones = [], actions,
    onZoneClick, onZoneChange, onCreateTask, onTaskEdit, onTaskChange,
    onTaskDragChange, activeDrag,
}) => {
    const [currentDate, setCurrentDate] = useState(initialDate);
    const scrollRef = useRef<HTMLDivElement>(null);
    // The height at which a full day fits the viewport with no scrolling.
    const [fitHeight, setFitHeight] = useState(FALLBACK_HEIGHT);
    // 1 = fit the whole day; > 1 = zoomed in (day taller than the viewport).
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);
    const gridRef = useRef<HTMLDivElement>(null);

    const columnHeight = Math.round(fitHeight * zoom);

    // Measure the scroll viewport so the default zoom shows the full day.
    useLayoutEffect(() => {
        const measure = () => {
            const height = scrollRef.current?.offsetHeight;
            if (height && height > 0) setFitHeight(height);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (scrollRef.current) observer.observe(scrollRef.current);
        return () => observer.disconnect();
    }, []);

    // Mouse wheel adjusts the zoom factor, anchored on the cursor.  Attached
    // natively so the page scroll can be prevented (Shift+wheel still scrolls).
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;
        const onWheel = (event: WheelEvent) => {
            if (event.shiftKey) return; // escape hatch: native scroll
            event.preventDefault();
            const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
            const prev = zoomRef.current;
            const next = Math.min(MAX_ZOOM, Math.max(1, prev * factor));
            if (next === prev) return;
            zoomRef.current = next;
            setZoom(next);
            // Keep the time under the cursor stationary while zooming.
            const rect = container.getBoundingClientRect();
            const pointerY = event.clientY - rect.top;
            const newScrollTop = (container.scrollTop + pointerY) * (next / prev) - pointerY;
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => { container.scrollTop = newScrollTop; });
            } else {
                container.scrollTop = newScrollTop;
            }
        };
        container.addEventListener('wheel', onWheel, { passive: false });
        return () => container.removeEventListener('wheel', onWheel);
    }, []);

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

            {/* Days Header Row (outside the scroll area, so it stays visible) */}
            <Box sx={{ display: 'flex', width: '100%', borderBottom: '1px solid #333', backgroundColor: '#1e1e1e', zIndex: 10, flexShrink: 0 }}>
                {days.map((day, index) => (
                    <Box key={index} sx={{ flex: 1, minWidth: '200px', p: 1, textAlign: 'center', borderRight: index < 6 ? '1px solid #333' : 'none' }}>
                        <Typography variant="subtitle2" sx={{ color: '#aaa', fontWeight: 'bold' }}>
                            {day.toLocaleDateString('de-DE', { weekday: 'short' }).toUpperCase()}
                        </Typography>
                        <Typography variant="h5" sx={{ fontWeight: 'normal' }}>
                            {day.getDate().toString().padStart(2, '0')}
                        </Typography>
                    </Box>
                ))}
            </Box>

            {/* Week Grid (scrollable; wheel zooms) */}
            <Box ref={scrollRef} data-testid="week-scroll" sx={{ display: 'flex', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'auto' }}>
                <Box ref={gridRef} data-testid="week-grid" data-column-height={columnHeight} sx={{ position: 'relative', display: 'flex', width: '100%', height: columnHeight, flexShrink: 0 }}>
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
                            <Box key={index} sx={{ flex: 1, minWidth: '200px', borderRight: index < 6 ? '1px solid #333' : 'none' }}>
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
    );
};
