/**
 * The plan as the Week view and the tracker show it (README: Planning
 * light): the stored plan fitted to the tasks and the clock, recomputed when
 * either changes and every minute — never by asking the server to plan.
 */
import { useMemo } from 'react';

import { useDependencies, usePlan, useSettings, useTasks } from '../queries.tsx';
import { parseDurationMinutes } from '../utils/duration.ts';
import { lightPlan, type LightPlan } from '../utils/lightPlan.ts';
import { useNow } from './useNow.ts';

export function useLightPlan(): { data: LightPlan | undefined; isPending: boolean; isError: boolean } {
    const plan = usePlan();
    const tasks = useTasks();
    const dependencies = useDependencies();
    const settings = useSettings();
    // Every minute, and the moment the tasks or the plan change (a stop, a
    // completion): the light plan is about this very moment.
    const tick = useNow(60_000);
    const defaultMinutes = parseDurationMinutes(settings.data?.default_duration ?? null) ?? 60;
    // Shown once all of it is there: no stored plan first and the fitted one
    // a moment later.
    const ready = plan.data !== undefined && !tasks.isPending && !dependencies.isPending;
    const data = useMemo(() => {
        if (!ready || !plan.data) return undefined;
        // No task list (it failed to load): the plan as it is stored.
        if (!tasks.data) return { plan: plan.data, notes: { overflow: [], dropped: [] } };
        return lightPlan(plan.data, {
            tasks: tasks.data, dependencies: dependencies.data ?? [],
            now: new Date(Math.max(tick.getTime(), tasks.dataUpdatedAt, plan.dataUpdatedAt)), defaultMinutes,
        });
    }, [ready, plan.data, plan.dataUpdatedAt, tasks.data, tasks.dataUpdatedAt, dependencies.data, tick,
        defaultMinutes]);
    return { data, isPending: !ready && !plan.isError, isError: plan.isError };
}
