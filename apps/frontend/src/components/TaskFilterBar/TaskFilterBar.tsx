/**
 * The filter bar of the Tasks tab and the dependency editor (README:
 * Filtering tasks): a search and filters by project, tag, estimate, time
 * worked and priority. Different filters must all hold; the choices within
 * one are alternatives.
 *
 * Desktop: the search and one button per filter, each showing what it is set
 * to and opening its choices in a popover; then "12 of 87 tasks · Clear".
 * Phones: the search and a filter button (with the number of filters on)
 * that opens every filter in a bottom sheet; below, what is on as removable
 * chips. "/" jumps to the search, Esc empties it.
 */
import { useRef, useState, type ReactNode } from 'react';
import {
    Badge, Box, Button, Checkbox, Chip, Divider, Drawer, FormControlLabel, IconButton, InputAdornment, Popover, Slider,
    TextField, Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import SearchIcon from '@mui/icons-material/Search';

import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts.ts';
import { useIsMobile } from '../../hooks/useResponsive.ts';
import type { Tag } from '../../types.ts';
import type { ProjectOption } from '../../utils/projects.ts';
import {
    ACTIVE_PROJECT, EMPTY_FILTER, ESTIMATE_LABELS, FILTER_KIND_LABELS, NO_TAG, PRIORITY_RANGE, WORKED_LABELS,
    isFiltering, kindSummary, toggled, withoutKind,
    type EstimatePreset, type FilterKind, type TaskFilter, type WorkedPreset,
} from '../../utils/taskFilter.ts';

const KINDS: FilterKind[] = ['projects', 'tags', 'estimates', 'worked', 'priority'];

export interface TaskFilterBarProps {
    filter: TaskFilter;
    onChange: (filter: TaskFilter) => void;
    /** The projects to choose from (``projectOptions``). */
    projects: ProjectOption[];
    tags: Tag[];
    /** How many tasks pass, of how many shown without the filter. */
    matchCount: number;
    totalCount: number;
    /** Phones: more view settings for the sheet (e.g. "Show completed"). */
    sheetExtras?: ReactNode;
}

export function TaskFilterBar({
    filter, onChange, projects, tags, matchCount, totalCount, sheetExtras,
}: TaskFilterBarProps) {
    const mobile = useIsMobile();
    const search = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState<{ kind: FilterKind; anchor: HTMLElement } | null>(null);
    const [sheetOpen, setSheetOpen] = useState(false);
    useGlobalShortcuts({ '/': () => search.current?.focus() });

    const sources = {
        projectName: (id: string) => projects.find(p => p.id === id)?.header,
        tagName: (id: string) => tags.find(t => t.id === id)?.name,
    };
    const filtering = isFiltering(filter);
    const kindsOn = KINDS.filter(kind => kindSummary(filter, kind, sources) !== null);
    const count = `${matchCount} of ${totalCount} tasks`;

    const searchField = (
        <TextField size="small" inputRef={search} value={filter.search} placeholder={mobile ? 'Search…' : 'Search… ( / )'}
            onChange={event => onChange({ ...filter, search: event.target.value })}
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                if (filter.search) onChange({ ...filter, search: '' }); else search.current?.blur();
            }}
            sx={{ width: mobile ? 'auto' : 240, flex: mobile ? 1 : undefined, minWidth: 0 }}
            slotProps={{
                htmlInput: { 'aria-label': 'Search tasks' },
                input: {
                    startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                    endAdornment: filter.search ? (
                        <InputAdornment position="end">
                            <IconButton size="small" edge="end" aria-label="clear search"
                                onClick={() => onChange({ ...filter, search: '' })}>
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </InputAdornment>
                    ) : undefined,
                },
            }} />
    );

    const section = (kind: FilterKind) => (
        <FilterChoices kind={kind} filter={filter} onChange={onChange} projects={projects} tags={tags} inSheet={mobile} />
    );

    if (mobile) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {searchField}
                    <IconButton aria-label="filters" onClick={() => setSheetOpen(true)}
                        color={kindsOn.length ? 'primary' : 'default'}>
                        <Badge badgeContent={kindsOn.length} color="primary"><FilterListIcon /></Badge>
                    </IconButton>
                </Box>
                {filtering && (
                    <Box data-testid="active-filters" sx={{
                        display: 'flex', alignItems: 'center', gap: 0.75, overflowX: 'auto', whiteSpace: 'nowrap',
                        scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' },
                    }}>
                        {kindsOn.map(kind => (
                            <Chip key={kind} size="small" color="primary" variant="outlined"
                                label={kindSummary(filter, kind, sources)}
                                onClick={() => setSheetOpen(true)}
                                onDelete={() => onChange(withoutKind(filter, kind))}
                                aria-label={`${FILTER_KIND_LABELS[kind]}: ${kindSummary(filter, kind, sources)}`}
                                sx={{ flexShrink: 0 }} />
                        ))}
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, ml: 0.5 }}>{count}</Typography>
                    </Box>
                )}
                <Drawer anchor="bottom" open={sheetOpen} onClose={() => setSheetOpen(false)}
                    slotProps={{ paper: { sx: { maxHeight: '85vh', borderTopLeftRadius: 12, borderTopRightRadius: 12 } } }}>
                    <Box role="dialog" aria-label="Filters" sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1.5, pb: 0.5 }}>
                            <Typography variant="h6" sx={{ flex: 1 }}>Filters</Typography>
                            <IconButton aria-label="close filters" onClick={() => setSheetOpen(false)}><CloseIcon /></IconButton>
                        </Box>
                        <Box sx={{ overflowY: 'auto', px: 2, pb: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {KINDS.map(kind => (
                                <Box key={kind} component="section" aria-label={FILTER_KIND_LABELS[kind]}>
                                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{FILTER_KIND_LABELS[kind]}</Typography>
                                    {section(kind)}
                                </Box>
                            ))}
                            {sheetExtras && <><Divider />{sheetExtras}</>}
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: 1, borderColor: 'divider' }}>
                            <Button disabled={!filtering} onClick={() => onChange(EMPTY_FILTER)}>Clear</Button>
                            <Button variant="contained" sx={{ flex: 1 }} onClick={() => setSheetOpen(false)}>
                                Show {matchCount} {matchCount === 1 ? 'task' : 'tasks'}
                            </Button>
                        </Box>
                    </Box>
                </Drawer>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {searchField}
            {KINDS.map(kind => {
                const summary = kindSummary(filter, kind, sources);
                return (
                    <Button key={kind} size="small" variant={summary ? 'contained' : 'outlined'} disableElevation
                        color={summary ? 'primary' : 'inherit'} endIcon={<ArrowDropDownIcon />}
                        aria-haspopup="dialog" aria-expanded={open?.kind === kind}
                        onClick={event => setOpen({ kind, anchor: event.currentTarget })}
                        sx={{ textTransform: 'none', ...(summary ? {} : { color: 'text.secondary', borderColor: 'divider' }) }}>
                        {summary ? `${FILTER_KIND_LABELS[kind]}: ${summary}` : FILTER_KIND_LABELS[kind]}
                    </Button>
                );
            })}
            {filtering && (
                <>
                    <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>{count}</Typography>
                    <Button size="small" onClick={() => onChange(EMPTY_FILTER)}>Clear</Button>
                </>
            )}
            <Popover open={open !== null} anchorEl={open?.anchor ?? null} onClose={() => setOpen(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                slotProps={{ paper: { role: 'dialog', 'aria-label': open ? FILTER_KIND_LABELS[open.kind] : undefined } as object }}>
                {open && (
                    <Box sx={{ p: 1.5, minWidth: 240, maxWidth: 360 }}>
                        {section(open.kind)}
                        {kindSummary(filter, open.kind, sources) && (
                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                                <Button size="small" onClick={() => onChange(withoutKind(filter, open.kind))}>
                                    Clear {FILTER_KIND_LABELS[open.kind].toLowerCase()}
                                </Button>
                            </Box>
                        )}
                    </Box>
                )}
            </Popover>
        </Box>
    );
}

/** The choices of one filter kind — the same in the popover and the sheet. */
function FilterChoices({ kind, filter, onChange, projects, tags, inSheet }: {
    kind: FilterKind; filter: TaskFilter; onChange: (filter: TaskFilter) => void;
    projects: ProjectOption[]; tags: Tag[];
    /** In the phone sheet, which scrolls as a whole (no nested scrolling). */
    inSheet: boolean;
}) {
    switch (kind) {
        case 'projects':
            return (
                <Box sx={{ display: 'flex', flexDirection: 'column', ...(inSheet ? {} : { maxHeight: 320, overflowY: 'auto' }) }}>
                    {[{ id: ACTIVE_PROJECT, header: 'Active project', depth: 0, color: null as string | null }, ...projects]
                        .map(project => (
                            <FormControlLabel key={project.id} sx={{ ml: project.depth * 2, mr: 0 }}
                                control={<Checkbox size="small" checked={filter.projects.includes(project.id)}
                                    onChange={() => onChange({ ...filter, projects: toggled(filter.projects, project.id) })} />}
                                label={(
                                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                                        {project.color && (
                                            <Box component="span" aria-hidden style={{ backgroundColor: project.color }}
                                                sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
                                        )}
                                        <Typography variant="body2" component="span"
                                            sx={{ fontStyle: project.id === ACTIVE_PROJECT ? 'italic' : undefined }}>
                                            {project.header}
                                        </Typography>
                                    </Box>
                                )} />
                        ))}
                </Box>
            );
        case 'tags':
            return (
                <ChoiceChips
                    options={[...tags.map(tag => ({ value: tag.id, label: `#${tag.name}` })), { value: NO_TAG, label: 'No tag' }]}
                    chosen={filter.tags} onToggle={id => onChange({ ...filter, tags: toggled(filter.tags, id) })} />
            );
        case 'estimates':
            return (
                <ChoiceChips
                    options={(Object.keys(ESTIMATE_LABELS) as EstimatePreset[]).map(value => ({ value, label: ESTIMATE_LABELS[value] }))}
                    chosen={filter.estimates}
                    onToggle={value => onChange({ ...filter, estimates: toggled(filter.estimates, value as EstimatePreset) })} />
            );
        case 'worked':
            return (
                <ChoiceChips
                    options={(Object.keys(WORKED_LABELS) as WorkedPreset[]).map(value => ({ value, label: WORKED_LABELS[value] }))}
                    chosen={filter.worked}
                    onToggle={value => onChange({ ...filter, worked: toggled(filter.worked, value as WorkedPreset) })} />
            );
        case 'priority':
            return (
                <Box sx={{ px: 1.5, pt: 3 }}>
                    <Slider size="small" min={PRIORITY_RANGE[0]} max={PRIORITY_RANGE[1]} step={1} marks
                        value={filter.priority} valueLabelDisplay="on" disableSwap
                        getAriaLabel={index => (index === 0 ? 'lowest priority' : 'highest priority')}
                        onChange={(_event, value) => onChange({ ...filter, priority: value as [number, number] })} />
                </Box>
            );
    }
}

/** Toggle chips: filled when chosen. */
function ChoiceChips({ options, chosen, onToggle }: {
    options: { value: string; label: string }[]; chosen: string[]; onToggle: (value: string) => void;
}) {
    return (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {options.map(option => {
                const on = chosen.includes(option.value);
                return (
                    <Chip key={option.value} label={option.label} size="small" clickable
                        color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'}
                        aria-pressed={on} onClick={() => onToggle(option.value)} />
                );
            })}
        </Box>
    );
}
