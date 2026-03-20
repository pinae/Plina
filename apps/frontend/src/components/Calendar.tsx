import React, { useEffect, useState } from 'react';
import { Typography, Paper, Box, Card, CardContent, Chip, Alert } from '@mui/material';
import api from '../api';

interface PlanItem {
    task_id: string;
    header: string;
    start_time: string;
    duration: number; // seconds
    warnings: string[];
}

interface BucketPlan {
    [bucket_id: string]: PlanItem[];
}

interface TimeBucket {
    id: string;
    start_date: string;
    duration: string; // "P0DT04H00M00S" format from Django
    type: {
        id: string;
        name: string;
        hex_color: string;
    };
}

export default function Calendar() {
    const [plan, setPlan] = useState<BucketPlan>({});
    const [buckets, setBuckets] = useState<TimeBucket[]>([]);

    useEffect(() => {
        // Fetch Plan
        api.get('plan/')
            .then(response => {
                setPlan(response.data);
            })
            .catch(error => console.error("Error fetching plan:", error));

        // Fetch Buckets info (to display headers/empty buckets)
        api.get('timebuckets/')
            .then(response => {
                setBuckets(response.data);
            })
            .catch(error => console.error("Error fetching buckets:", error));
    }, []);

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Calendar Plan
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {buckets.map(bucket => {
                    const items = plan[bucket.id] || [];
                    const bucketStart = new Date(bucket.start_date);
                    // Duration parsing is tricky if complex, but simple ISO string usually works or assume 4h.
                    // For display, we just show Start Time.

                    return (
                        <Paper key={bucket.id} sx={{ p: 2, borderLeft: 6, borderColor: bucket.type.hex_color || '#539dad' }}>
                            <Typography variant="h6">
                                {bucketStart.toLocaleDateString()} {bucketStart.toLocaleTimeString()} - {bucket.type.name}
                            </Typography>
                            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {items.length === 0 && <Typography variant="body2" color="text.secondary">Empty Bucket</Typography>}
                                {items.map((item, idx) => (
                                    <Card key={idx} sx={{ minWidth: 200, bgcolor: 'background.default' }}>
                                        <CardContent>
                                            <Typography variant="subtitle2">{item.header}</Typography>
                                            <Typography variant="caption" display="block">
                                                {new Date(item.start_time).toLocaleTimeString()} ({Math.round(item.duration / 60)}m)
                                            </Typography>
                                            {item.warnings.map(w => (
                                                <Alert severity="warning" key={w} sx={{ py: 0 }}>{w}</Alert>
                                            ))}
                                        </CardContent>
                                    </Card>
                                ))}
                            </Box>
                        </Paper>
                    );
                })}
            </Box>
        </Box>
    );
}
