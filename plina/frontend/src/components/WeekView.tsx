
import { useEffect, useState } from 'react';
import { Typography, Paper, Box } from '@mui/material';
import api from '../api';

interface PlanItem {
    task_id: string;
    header: string;
    start_time: string;
    duration: number; // seconds
    warnings: string[];
    is_fixed?: boolean;
    hex_color?: string; // from task or project
}

interface BucketPlan {
    [bucket_id: string]: PlanItem[];
}

interface TimeBucket {
    id: string;
    start_date: string;
    duration: string;
    type: {
        id: string;
        name: string;
        hex_color: string;
    };
}

// Layout Constants
const START_HOUR = 0;
const END_HOUR = 24;
const PIXELS_PER_HOUR = 60; // 1 pixel per minute
const PIXELS_PER_MINUTE = PIXELS_PER_HOUR / 60;

// Helper to get vibrant/pastel colors
const getColors = (hex: string, isFixed: boolean) => {
    if (!hex) return { bg: '#ccc', text: '#000' };
    if (isFixed) {
        return { bg: hex, text: '#fff' };
    } else {
        return {
            bg: hex,
            text: '#000',
            style: {
                opacity: 0.8, // Slightly transparent
                filter: 'brightness(1.2) saturate(0.6)',
                borderLeft: `3px solid ${hex} `
            }
        };
    }
};

const getPositionStyles = (startDateStr: string, durationSeconds: number, dayStart: Date) => {
    const start = new Date(startDateStr);

    // Calculate minutes from dayStart (00:00 of that day)
    // dayStart should be 00:00 local time

    // Diff in minutes
    // We assume start is same day as dayStart for this simple view
    const diffMs = start.getTime() - dayStart.getTime();
    const startMinutes = diffMs / 60000;

    const heightMinutes = durationSeconds / 60;

    return {
        top: Math.round(startMinutes * PIXELS_PER_MINUTE),
        height: Math.round(heightMinutes * PIXELS_PER_MINUTE)
    };
};

// Parse bucket duration "P0DT04H00M00S" or similar
// Actually Django DurationField usually returns string or we can rely on start/end comparison if we have end date.
// But we have start_date and duration.
// Let's assume duration is ISO string or HMS.
// For simplicity in this demo, let's look at the buckets prop structure seen in prev step or just calculate from known demo data.
// In the planner API, bucket duration was seconds (total_seconds) for tasks. For buckets endpoint, check serializer.
// Serializer for TimeBucket uses ModelSerializer. It serializes DurationField as string "HH:MM:SS" usually.
const parseDurationString = (dur: string) => {
    // "HH:MM:SS"
    const parts = dur.split(':');
    if (parts.length === 3) {
        return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
    }
    return 3600; // fallback 1h
};

export default function WeekView() {
    const [plan, setPlan] = useState<BucketPlan>({});
    const [buckets, setBuckets] = useState<TimeBucket[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            const [planRes, bucketRes] = await Promise.all([
                api.get('plan/'),
                api.get('timebuckets/')
            ]);
            setPlan(planRes.data);
            setBuckets(bucketRes.data);
        };
        fetchData();
    }, []);

    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i);
        d.setHours(0, 0, 0, 0);
        return d;
    });

    const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', bgcolor: '#121212', color: '#fff' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">Week Overview</Typography>
            </Box>

            <Box sx={{ display: 'flex', flexGrow: 1, overflowY: 'auto', position: 'relative' }}>

                {/* Time Scale Axis */}
                <Box sx={{ width: 60, flexShrink: 0, borderRight: '1px solid #444', bgcolor: '#1e1e1e', position: 'sticky', left: 0, zIndex: 20 }}>
                    {hours.map(h => (
                        <Box key={h} sx={{ height: PIXELS_PER_HOUR, borderBottom: '1px solid #333', position: 'relative' }}>
                            <Typography variant="caption" sx={{ position: 'absolute', top: -10, right: 8, color: '#aaa', fontSize: '0.75rem' }}>
                                {h}:00
                            </Typography>
                        </Box>
                    ))}
                </Box>

                {/* Days Grid */}
                <Box sx={{ display: 'flex', flexGrow: 1, minWidth: 800, width: '100%', bgcolor: '#121212' }}>
                    {days.map(day => {
                        const dayEnd = new Date(day);
                        dayEnd.setDate(dayEnd.getDate() + 1);

                        // Filter buckets for this day
                        const dayBuckets = buckets.filter(b => {
                            const bStart = new Date(b.start_date);
                            return bStart >= day && bStart < dayEnd;
                        });

                        const isToday = new Date().toDateString() === day.toDateString();

                        return (
                            <Box key={day.toISOString()} sx={{ flex: 1, borderRight: '1px solid #333', position: 'relative', minWidth: 120 }}>
                                {/* Header */}
                                <Box sx={{ p: 1, textAlign: 'center', borderBottom: '1px solid #444', bgcolor: '#1e1e1e', position: 'sticky', top: 0, zIndex: 10 }}>
                                    <Typography variant="caption" sx={{ display: 'block', color: (isToday ? '#539dad' : '#aaa'), textTransform: 'uppercase' }}>
                                        {day.toLocaleDateString(undefined, { weekday: 'short' })}
                                    </Typography>
                                    <Typography variant="h5" sx={{
                                        display: 'inline-block',
                                        width: 36,
                                        height: 36,
                                        lineHeight: '36px',
                                        borderRadius: '50%',
                                        bgcolor: (isToday ? '#539dad' : 'transparent'),
                                        color: (isToday ? '#000' : '#fff'),
                                        fontWeight: 'bold'
                                    }}>
                                        {day.getDate()}
                                    </Typography>
                                </Box>

                                {/* Grid Lines */}
                                <Box sx={{ position: 'relative', height: PIXELS_PER_HOUR * (END_HOUR - START_HOUR), bgcolor: '#121212' }}>
                                    {hours.map(h => (
                                        <Box key={h} sx={{ height: PIXELS_PER_HOUR, borderBottom: '1px solid #333', boxSizing: 'border-box' }} />
                                    ))}

                                    {/* Buckets (Slim Columns) */}
                                    {dayBuckets.map(b => {
                                        const durationSec = parseDurationString(b.duration);
                                        const pos = getPositionStyles(b.start_date, durationSec, day);

                                        return (
                                            <Box key={b.id} title={b.type.name} sx={{
                                                position: 'absolute',
                                                left: 0,
                                                width: 8, // Slim column
                                                bgcolor: b.type.hex_color || '#539dad',
                                                borderRadius: 0,
                                                opacity: 0.7,
                                                ...pos
                                            }} />
                                        );
                                    })}

                                    {/* Tasks */}
                                    {dayBuckets.map(b => {
                                        const items = plan[b.id] || [];
                                        return items.map((item, idx) => {
                                            const isFixed = item.is_fixed;
                                            const colors = getColors(item.hex_color || '#539dad', !!isFixed);
                                            const pos = getPositionStyles(item.start_time, item.duration, day);

                                            return (
                                                <Box key={`${b.id} -${idx} `} sx={{
                                                    position: 'absolute',
                                                    left: 12, // Offset of bucket width + gap
                                                    right: 2,
                                                    padding: 0.5,
                                                    bgcolor: colors.bg,
                                                    color: colors.text,
                                                    borderRadius: 1,
                                                    fontSize: '0.75rem',
                                                    overflow: 'hidden',
                                                    ...colors.style,
                                                    ...pos,
                                                    zIndex: 1
                                                }}>
                                                    <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {item.header}
                                                    </div>
                                                    <div style={{ opacity: 0.8 }}>
                                                        {new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </Box>
                                            );
                                        });
                                    })}
                                </Box>
                            </Box>
                        );
                    })}
                </Box>
            </Box>
        </Box>
    );
}

