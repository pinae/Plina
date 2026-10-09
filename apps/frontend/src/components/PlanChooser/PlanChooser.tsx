/**
 * "Plan my week" options as "What's next" cards (docs/plan-chooser.md, idea
 * A): what the option is about, the next tasks (always shown, the running one
 * marked "now"), the timeline of the first days (appointments grey — they are
 * the same in every option), its consequences, the whole plan behind
 * "Whole plan", and the choice. Warnings every option has are said once,
 * above the cards. One column on phones.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Card, CardActions, CardContent, Chip, Collapse, Stack,
    Tooltip, Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import FlagIcon from '@mui/icons-material/Flag';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { format } from 'date-fns';

import type { PlanAlternative, PlanWarning, Task } from '../../types.ts';
import {
    commonWarnings, formatSlack, isCommon, miniTimeline, nextTasks, planByDay, projectOf, slackSeverity, taskCount,
} from '../../utils/planChooser.ts';

const FALLBACK_COLOR = '#9e9e9e';

function warningText(warning: PlanWarning): string {
    if (warning.kind === 'deadline_missed') {
        return `“${warning.header}” misses its deadline`
            + (warning.projected_finish
                ? ` (projected ${format(new Date(warning.projected_finish), 'MMM d, HH:mm')})`
                : '');
    }
    return `“${warning.header}” doesn't fit within the planning horizon`;
}

const Dot = ({ color }: { color: string | null }) => (
    <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }}
        style={{ backgroundColor: color ?? FALLBACK_COLOR }} />
);

function MiniTimeline({ alternative, from }: { alternative: PlanAlternative; from: Date }) {
    const days = miniTimeline(alternative, 3, from);
    if (days.length === 0) return null;
    return (
        <Stack spacing={0.5} data-testid="mini-timeline">
            {days.map(day => (
                <Box key={day.dayLabel} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ width: 88, flexShrink: 0 }} noWrap>
                        {day.dayLabel}
                    </Typography>
                    <Box sx={{ display: 'flex', flexGrow: 1, height: 10, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
                        {day.blocks.map((block, index) => (
                            <Tooltip key={index} title={block.appointment ? `${block.header} (appointment)` : block.header}>
                                <Box sx={{ flexGrow: block.weight, minWidth: 3, opacity: block.appointment ? 0.5 : 1 }}
                                    style={{ backgroundColor: block.color }} />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>
            ))}
        </Stack>
    );
}

const when = (start: Date) => format(start, 'EEE HH:mm');

interface PlanAlternativeCardProps {
    alternative: PlanAlternative;
    tasks: Task[];
    runningTaskId: string | null;
    common: PlanWarning[];
    /** When the options were made: what is over by then is left out. */
    from: Date;
    onAccept: (planId: string) => void;
    accepting: boolean;
}

function PlanAlternativeCard({ alternative, tasks, runningTaskId, common, from, onAccept, accepting }: PlanAlternativeCardProps) {
    const { metrics } = alternative;
    const [wholeOpen, setWholeOpen] = useState(false);
    const next = nextTasks(alternative, { runningTaskId });
    const own = alternative.warnings.filter(warning => !isCommon(warning, common));
    const count = taskCount(alternative);
    return (
        <Card data-testid="plan-alternative-card" variant="outlined"
            sx={{ display: 'flex', flexDirection: 'column', borderColor: own.length ? 'warning.main' : 'divider' }}>
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                    {alternative.label}
                </Typography>

                {/* Next: the decision itself (P1). */}
                <Box component="ol" aria-label="Next" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {next.map((task, index) => (
                        <Box component="li" key={task.taskId} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <Dot color={task.color} />
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography variant={index === 0 ? 'subtitle1' : 'body2'} noWrap
                                    sx={{ fontWeight: index === 0 ? 'bold' : undefined }}>
                                    {task.header}
                                </Typography>
                                {projectOf(task.taskId, tasks) && (
                                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                                        {projectOf(task.taskId, tasks)}
                                    </Typography>
                                )}
                            </Box>
                            {task.running
                                ? <Chip size="small" color="success" label="now" sx={{ flexShrink: 0 }} />
                                : <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{when(task.start)}</Typography>}
                        </Box>
                    ))}
                    {next.length === 0 && (
                        <Typography variant="body2" color="text.secondary" component="li">Nothing planned.</Typography>
                    )}
                </Box>

                <MiniTimeline alternative={alternative} from={from} />

                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Chip size="small" color={slackSeverity(metrics.min_slack_seconds)} icon={<FlagIcon />}
                        label={formatSlack(metrics.min_slack_seconds)} />
                    <Chip size="small" icon={<SwapHorizIcon />} label={`${metrics.context_switches} switches`} />
                    {metrics.project_finishes.map(finish => (
                        <Chip key={finish.project_id} size="small" variant="outlined"
                            label={`${finish.name} → ${format(new Date(finish.finish), 'MMM d')}`} />
                    ))}
                </Stack>
                {own.map(warning => (
                    <Alert key={`${warning.task_id}-${warning.kind}`} severity="warning" sx={{ py: 0 }}>
                        {warningText(warning)}
                    </Alert>
                ))}

                {count > 0 && (
                    <Box>
                        <Button size="small" onClick={() => setWholeOpen(open => !open)} aria-expanded={wholeOpen}
                            endIcon={wholeOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />} sx={{ textTransform: 'none', px: 0 }}>
                            Whole plan ({count} {count === 1 ? 'task' : 'tasks'})
                        </Button>
                        <Collapse in={wholeOpen} unmountOnExit>
                            <Box component="ul" aria-label="Whole plan"
                                sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: 280, overflowY: 'auto' }}>
                                {planByDay(alternative, from).map(day => [
                                    <Box component="li" role="presentation" key={day.dayLabel} sx={{ pt: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                                            {day.dayLabel}
                                        </Typography>
                                    </Box>,
                                    ...day.items.map(item => (
                                        <Box component="li" key={`${item.taskId}@${item.start.toISOString()}`}
                                            role={item.isAppointment ? 'presentation' : undefined}
                                            sx={{ display: 'flex', gap: 1, color: item.isAppointment ? 'text.secondary' : undefined }}>
                                            <Typography variant="caption" sx={{ width: 84, flexShrink: 0 }}>
                                                {format(item.start, 'HH:mm')}–{format(item.end, 'HH:mm')}
                                            </Typography>
                                            <Typography variant="caption" noWrap sx={{ fontStyle: item.isAppointment ? 'italic' : undefined }}>
                                                {item.header}
                                            </Typography>
                                        </Box>
                                    )),
                                ])}
                            </Box>
                        </Collapse>
                    </Box>
                )}
            </CardContent>
            <CardActions>
                <Button fullWidth variant="contained" disabled={accepting}
                    onClick={() => alternative.id && onAccept(alternative.id)}>
                    Choose this plan
                </Button>
            </CardActions>
        </Card>
    );
}

interface PlanChooserProps {
    alternatives: PlanAlternative[];
    /** For project names and the running task (optional: without, neither). */
    tasks?: Task[];
    onAccept: (planId: string) => void;
    accepting: boolean;
}

/** The options side by side (one column on phones). */
export function PlanChooser({ alternatives, tasks = [], onAccept, accepting }: PlanChooserProps) {
    const common = commonWarnings(alternatives);
    const [from] = useState(() => new Date());
    const runningTaskId = tasks.find(task => task.active_tracking_start)?.id ?? null;
    return (
        <Stack spacing={2}>
            {common.length > 0 && (
                <Alert severity="warning" data-testid="common-warnings">
                    {common.map(warning => (
                        <div key={`${warning.task_id}-${warning.kind}`}>In every plan: {warningText(warning)}</div>
                    ))}
                </Alert>
            )}
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(280px, 1fr))' } }}>
                {alternatives.map(alternative => (
                    <PlanAlternativeCard
                        key={alternative.id ?? alternative.label}
                        alternative={alternative}
                        tasks={tasks}
                        runningTaskId={runningTaskId}
                        common={common}
                        from={from}
                        onAccept={onAccept}
                        accepting={accepting}
                    />
                ))}
            </Box>
        </Stack>
    );
}
