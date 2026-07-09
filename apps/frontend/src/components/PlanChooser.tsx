import {
    Alert, Box, Button, Card, CardActions, CardContent, Chip, Stack,
    Tooltip, Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import FlagIcon from '@mui/icons-material/Flag';
import { format } from 'date-fns';

import type { PlanAlternative, PlanWarning } from '../types';
import { formatSlack, miniTimeline, slackSeverity } from '../utils/planChooser';

function warningText(warning: PlanWarning): string {
    if (warning.kind === 'deadline_missed') {
        return `“${warning.header}” misses its deadline`
            + (warning.projected_finish
                ? ` (projected ${format(new Date(warning.projected_finish), 'MMM d, HH:mm')})`
                : '');
    }
    return `“${warning.header}” doesn't fit within the planning horizon`;
}

function MiniTimeline({ alternative }: { alternative: PlanAlternative }) {
    const days = miniTimeline(alternative, 3);
    if (days.length === 0) return null;
    return (
        <Stack spacing={0.5} sx={{ mt: 1.5 }} data-testid="mini-timeline">
            {days.map(day => (
                <Box key={day.dayLabel} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ width: 88, flexShrink: 0 }} noWrap>
                        {day.dayLabel}
                    </Typography>
                    <Box sx={{ display: 'flex', flexGrow: 1, height: 10, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover' }}>
                        {day.blocks.map((block, index) => (
                            <Tooltip key={index} title={block.header}>
                                <Box sx={{ flexGrow: block.weight, backgroundColor: block.color, minWidth: 3 }} />
                            </Tooltip>
                        ))}
                    </Box>
                </Box>
            ))}
        </Stack>
    );
}

interface PlanAlternativeCardProps {
    alternative: PlanAlternative;
    onAccept: (planId: string) => void;
    accepting: boolean;
}

function PlanAlternativeCard({ alternative, onAccept, accepting }: PlanAlternativeCardProps) {
    const { metrics } = alternative;
    return (
        <Card
            data-testid="plan-alternative-card"
            variant="outlined"
            sx={{
                width: 340, display: 'flex', flexDirection: 'column',
                borderColor: alternative.feasible ? 'divider' : 'warning.main',
            }}
        >
            <CardContent sx={{ flexGrow: 1 }}>
                <Typography variant="h6" gutterBottom>{alternative.label}</Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <Chip
                        size="small"
                        color={slackSeverity(metrics.min_slack_seconds)}
                        icon={<FlagIcon />}
                        label={formatSlack(metrics.min_slack_seconds)}
                    />
                    <Chip
                        size="small"
                        icon={<SwapHorizIcon />}
                        label={`${metrics.context_switches} switches`}
                    />
                </Stack>
                {metrics.project_finishes.length > 0 && (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
                        {metrics.project_finishes.map(finish => (
                            <Chip
                                key={finish.project_id} size="small" variant="outlined"
                                label={`${finish.name} → ${format(new Date(finish.finish), 'MMM d')}`}
                            />
                        ))}
                    </Stack>
                )}
                <MiniTimeline alternative={alternative} />
                {alternative.warnings.map(warning => (
                    <Alert
                        key={`${warning.task_id}-${warning.kind}`}
                        severity="warning" sx={{ mt: 1, py: 0 }}
                    >
                        {warningText(warning)}
                    </Alert>
                ))}
            </CardContent>
            <CardActions>
                <Button
                    fullWidth variant="contained" disabled={accepting}
                    onClick={() => alternative.id && onAccept(alternative.id)}
                >
                    Choose this plan
                </Button>
            </CardActions>
        </Card>
    );
}

interface PlanChooserProps {
    alternatives: PlanAlternative[];
    onAccept: (planId: string) => void;
    accepting: boolean;
}

/** Pure chooser grid — reused by the dialog (WP-10) and the post-completion
 *  "what next?" flow (WP-11). */
export function PlanChooser({ alternatives, onAccept, accepting }: PlanChooserProps) {
    return (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
            {alternatives.map(alternative => (
                <PlanAlternativeCard
                    key={alternative.id ?? alternative.label}
                    alternative={alternative}
                    onAccept={onAccept}
                    accepting={accepting}
                />
            ))}
        </Box>
    );
}
