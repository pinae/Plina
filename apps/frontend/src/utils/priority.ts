/** T-5: priority bands for colour coding, like Todoist's coloured flags
 *  (docs/tasks-tab.md §3.1): 0–3 low, 4–6 normal, 7–8 high, 9–10 urgent. */
export type PriorityBand = 'low' | 'normal' | 'high' | 'urgent';

export const priorityBand = (priority: number): PriorityBand =>
    priority >= 9 ? 'urgent' : priority >= 7 ? 'high' : priority >= 4 ? 'normal' : 'low';

/** Theme colours per band (grey, blue, orange, red). */
export const PRIORITY_COLOR: Record<PriorityBand, string> = {
    low: 'grey.500', normal: 'info.main', high: 'warning.main', urgent: 'error.main',
};
