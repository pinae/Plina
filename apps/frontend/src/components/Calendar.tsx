import { useEffect, useState } from 'react';
import { Typography, Paper, Box, Card, CardContent, Alert, Chip } from '@mui/material';
import api from '../api';

interface PlanItem {
    task_id: string;
    header: string;
    start_time: string;
    duration: number; // seconds
    warnings: string[];
    is_fixed: boolean;
    is_appointment: boolean;
    hex_color: string | null;
}

interface PlannedBucket {
    id: string;
    start_date: string;
    end_date: string;
    type_name: string;
    hex_color: string | null;
    items: PlanItem[];
}

interface Plan {
    appointments: PlanItem[];
    buckets: PlannedBucket[];
}

function ItemCard({ item }: { item: PlanItem }) {
    return (
        <Card sx={{ minWidth: 200, bgcolor: 'background.default' }}>
            <CardContent>
                <Typography variant="subtitle2">
                    {item.header}
                    {item.is_appointment && <Chip label="appointment" size="small" sx={{ ml: 1 }} />}
                    {item.is_fixed && !item.is_appointment && <Chip label="fixed" size="small" sx={{ ml: 1 }} />}
                </Typography>
                <Typography variant="caption" display="block">
                    {new Date(item.start_time).toLocaleString()} ({Math.round(item.duration / 60)}m)
                </Typography>
                {item.warnings.map(w => (
                    <Alert severity="warning" key={w} sx={{ py: 0 }}>{w}</Alert>
                ))}
            </CardContent>
        </Card>
    );
}

export default function Calendar() {
    const [plan, setPlan] = useState<Plan>({ appointments: [], buckets: [] });

    useEffect(() => {
        api.get('plan/')
            .then(response => setPlan(response.data))
            .catch(error => console.error("Error fetching plan:", error));
    }, []);

    // Generated empty buckets far in the future are noise; show planned ones
    // plus the next few empty ones so the user sees upcoming free capacity.
    const nonEmpty = plan.buckets.filter(b => b.items.length > 0);
    const upcomingEmpty = plan.buckets.filter(b => b.items.length === 0).slice(0, 5);
    const visibleBuckets = [...nonEmpty, ...upcomingEmpty]
        .sort((a, b) => a.start_date.localeCompare(b.start_date));

    return (
        <Box>
            <Typography variant="h5" gutterBottom>
                Calendar Plan
            </Typography>
            {plan.appointments.length > 0 && (
                <Paper sx={{ p: 2, mb: 2, borderLeft: 6, borderColor: 'secondary.main' }}>
                    <Typography variant="h6">Appointments</Typography>
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {plan.appointments.map((item, idx) => <ItemCard key={idx} item={item} />)}
                    </Box>
                </Paper>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {visibleBuckets.map(bucket => {
                    const bucketStart = new Date(bucket.start_date);
                    return (
                        <Paper key={bucket.id} sx={{ p: 2, borderLeft: 6, borderColor: bucket.hex_color || '#539dad' }}>
                            <Typography variant="h6">
                                {bucketStart.toLocaleDateString()} {bucketStart.toLocaleTimeString()} - {bucket.type_name}
                            </Typography>
                            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                {bucket.items.length === 0 &&
                                    <Typography variant="body2" color="text.secondary">Empty Bucket</Typography>}
                                {bucket.items.map((item, idx) => <ItemCard key={idx} item={item} />)}
                            </Box>
                        </Paper>
                    );
                })}
            </Box>
        </Box>
    );
}
