/**
 * The time sheet (README: Time sheet): a month of tracked work, a row per
 * day — when work began and ended, the pauses and the working time. The
 * arrow opens a day: the tasks counted on it, their tags and their time.
 *
 * Work is time tracked on tasks tagged #Arbeit or #Work; time tracked on
 * #Freizeit or #Freetime tasks between the begin and end of work is a pause.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Collapse, IconButton, Paper, Table, TableBody, TableCell,
    TableContainer, TableFooter, TableHead, TableRow, Typography,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';

import { useTimeSheet } from '../../queries.tsx';
import type { TimeSheetDay } from '../../types.ts';
import { fromDateInput, toDateInput } from '../../utils/dateInput.ts';
import { hoursAndMinutes } from '../../utils/duration.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const dayLabel = (date: string) => fromDateInput(date).toLocaleDateString(undefined, {
    weekday: 'short', day: '2-digit', month: '2-digit',
});

const tagList = (names: string[]) => names.map(name => `#${name}`).join(' or ');

/** How many days after ``date`` the moment ``iso`` is (a night's work: 1). */
const daysLater = (date: string, iso: string) => {
    const end = new Date(iso);
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.round((endDay.getTime() - fromDateInput(date).getTime()) / (24 * 3600 * 1000));
};

function DayRows({ day, open, onToggle, compact }: {
    day: TimeSheetDay; open: boolean; onToggle: () => void; compact: boolean;
}) {
    const label = dayLabel(day.date);
    const later = daysLater(day.date, day.end);
    return (
        <>
            <TableRow hover onClick={onToggle} data-testid={`day-${day.date}`}
                sx={{ cursor: 'pointer', '& > td': { borderBottom: open ? 'unset' : undefined, whiteSpace: 'nowrap' } }}>
                <TableCell padding="checkbox">
                    <IconButton size="small" aria-expanded={open}
                        aria-label={`${open ? 'hide' : 'show'} the tasks of ${label}`}
                        onClick={event => { event.stopPropagation(); onToggle(); }}>
                        {open ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                    </IconButton>
                </TableCell>
                {/* Phones: "Thu 1" — the month is in the heading. */}
                <TableCell>{compact ? fromDateInput(day.date).toLocaleDateString(undefined, {
                    weekday: 'short', day: 'numeric',
                }) : label}</TableCell>
                <TableCell>{clock(day.begin)}</TableCell>
                <TableCell>
                    {clock(day.end)}
                    {later > 0 && (
                        <Typography component="span" variant="caption" color="text.secondary"
                            title={later === 1 ? 'the next day' : `${later} days later`} sx={{ ml: 0.5 }}>
                            +{later}
                        </Typography>
                    )}
                    {day.running && <Chip size="small" color="success" label="running" sx={{ ml: 0.5, height: 18 }} />}
                </TableCell>
                <TableCell align="right">{day.pause_seconds ? hoursAndMinutes(day.pause_seconds) : '—'}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 500 }}>{hoursAndMinutes(day.working_seconds)}</TableCell>
            </TableRow>
            <TableRow>
                <TableCell colSpan={6} sx={{ py: 0, ...(open ? {} : { borderBottom: 'unset' }) }}>
                    <Collapse in={open} timeout="auto" unmountOnExit>
                        <Table size="small" aria-label={`tasks of ${label}`} sx={{ mb: 1.5, mt: 0.5 }}>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Task</TableCell>
                                    <TableCell>Tags</TableCell>
                                    <TableCell align="right">Time</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {day.entries.map(entry => (
                                    <TableRow key={entry.task_id} data-kind={entry.kind}>
                                        <TableCell sx={{ overflowWrap: 'anywhere' }}>
                                            {entry.header}
                                            {entry.kind === 'pause' && (
                                                <Chip size="small" variant="outlined" label="pause" sx={{ ml: 0.75, height: 18 }} />
                                            )}
                                            {entry.running && (
                                                <Chip size="small" color="success" label="running" sx={{ ml: 0.75, height: 18 }} />
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                                {entry.tags.map(tag => (
                                                    <Chip key={tag.id} size="small" label={`#${tag.name}`}
                                                        sx={{ bgcolor: tag.hex_color, color: '#fff', height: 20 }} />
                                                ))}
                                            </Box>
                                        </TableCell>
                                        <TableCell align="right">{hoursAndMinutes(entry.seconds)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </Collapse>
                </TableCell>
            </TableRow>
        </>
    );
}

export default function TimeSheet({ initialMonth }: { initialMonth?: Date }) {
    const compact = useIsMobile();
    const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [month, setMonth] = useState(() => (initialMonth
        ? new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1) : thisMonth));
    const from = toDateInput(month);
    const to = toDateInput(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    const sheet = useTimeSheet(from, to);
    const [openDays, setOpenDays] = useState<Set<string>>(new Set());
    const toggle = (date: string) => setOpenDays(open => {
        const next = new Set(open);
        if (next.has(date)) next.delete(date);
        else next.add(date);
        return next;
    });
    const shift = (months: number) => setMonth(current => new Date(current.getFullYear(), current.getMonth() + months, 1));
    const monthName = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const days = sheet.data?.days ?? [];
    const workTags = tagList(sheet.data?.work_tags ?? ['Arbeit', 'Work']);
    const pauseTags = tagList(sheet.data?.pause_tags ?? ['Freizeit', 'Freetime']);
    const total = (key: 'working_seconds' | 'pause_seconds') => days.reduce((sum, day) => sum + day[key], 0);

    return (
        <Box sx={{ maxWidth: 900 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                <Typography variant="h5" sx={{ mr: 1 }}>Time Sheet</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <IconButton aria-label="previous month" onClick={() => shift(-1)}><ChevronLeftIcon /></IconButton>
                    <Typography variant={compact ? 'subtitle1' : 'h6'} component="h2"
                        sx={{ minWidth: compact ? 120 : 150, textAlign: 'center' }}>{monthName}</Typography>
                    <IconButton aria-label="next month" onClick={() => shift(1)}><ChevronRightIcon /></IconButton>
                </Box>
                {month.getTime() !== thisMonth.getTime() && (
                    <Button size="small" onClick={() => setMonth(thisMonth)}>This month</Button>
                )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Work is the time tracked on tasks tagged {workTags}: a day begins with the first and ends with the
                last of it. Time tracked on {pauseTags} tasks in between is a pause.
            </Typography>
            {sheet.isError ? (
                <Alert severity="error">The time sheet could not be loaded.</Alert>
            ) : (
                <TableContainer component={Paper}>
                    <Table size="small" aria-label="time sheet"
                        sx={compact ? { '& th, & td': { px: 0.5 }, '& .MuiTableCell-paddingCheckbox': { width: 32 } } : undefined}>
                        <TableHead>
                            <TableRow>
                                <TableCell padding="checkbox" />
                                <TableCell>Day</TableCell>
                                <TableCell>Begin</TableCell>
                                <TableCell>End</TableCell>
                                <TableCell align="right">Pause</TableCell>
                                <TableCell align="right">{compact ? 'Worked' : 'Working time'}</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sheet.isPending && (
                                <TableRow>
                                    <TableCell colSpan={6} align="center"><CircularProgress size={24} /></TableCell>
                                </TableRow>
                            )}
                            {!sheet.isPending && days.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        <Typography variant="body2" color="text.secondary">
                                            No work tracked in {monthName}. Track the time (▶) of tasks tagged {workTags}.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {days.map(day => (
                                <DayRows key={day.date} day={day} open={openDays.has(day.date)} compact={compact}
                                    onToggle={() => toggle(day.date)} />
                            ))}
                        </TableBody>
                        {days.length > 0 && (
                            <TableFooter>
                                <TableRow data-testid="time-sheet-total">
                                    <TableCell />
                                    <TableCell colSpan={3} sx={{ fontWeight: 500, color: 'text.primary' }}>
                                        {days.length === 1 ? '1 day' : `${days.length} days`}
                                    </TableCell>
                                    <TableCell align="right" sx={{ color: 'text.primary' }}>
                                        {hoursAndMinutes(total('pause_seconds'))}
                                    </TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                        {hoursAndMinutes(total('working_seconds'))}
                                    </TableCell>
                                </TableRow>
                            </TableFooter>
                        )}
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
}
