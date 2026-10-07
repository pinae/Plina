/**
 * Overlapping cards in a day column side by side (like a calendar): each
 * card gets a lane, and the number of lanes of its group of (transitively)
 * overlapping cards splits the column's width. E.g. an invitation and your
 * own appointment for the same meeting, both reachable to be merged.
 */
export interface Lane {
    index: number;
    count: number;
}

export function overlapLanes(tasks: { startTime: string; duration: number }[]): Lane[] {
    const order = tasks.map((task, i) => {
        const start = new Date(task.startTime).getTime();
        return { i, start, end: start + task.duration * 60000 };
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    const lanes: Lane[] = new Array(tasks.length);
    let group: number[] = [];
    let groupEnd = -Infinity;
    let laneEnds: number[] = [];
    const closeGroup = () => group.forEach(i => { lanes[i].count = laneEnds.length; });
    for (const item of order) {
        if (item.start >= groupEnd) {
            closeGroup();
            group = [];
            laneEnds = [];
        }
        let lane = laneEnds.findIndex(end => end <= item.start);
        if (lane < 0) lane = laneEnds.push(item.end) - 1;
        else laneEnds[lane] = item.end;
        lanes[item.i] = { index: lane, count: 1 };
        group.push(item.i);
        groupEnd = Math.max(groupEnd, item.end);
    }
    closeGroup();
    return lanes;
}
