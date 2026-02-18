import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { DayColumn } from './DayColumn';
import type { ViewTask } from './WeekViewTask';

// Helper to get Monday of the current week (assuming Mon start)
const getMonday = (d: Date) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(date.setDate(diff));
}

const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

interface WeekViewProps {
    tasks: ViewTask[];
    initialDate?: Date;
}

export const WeekView: React.FC<WeekViewProps> = ({ tasks, initialDate = new Date() }) => {
    const [currentDate, setCurrentDate] = useState(initialDate);

    const weekStart = getMonday(currentDate);
    const weekEnd = addDays(weekStart, 6);

    const handlePrevWeek = () => {
        setCurrentDate(addDays(currentDate, -7));
    };

    const handleNextWeek = () => {
        setCurrentDate(addDays(currentDate, 7));
    };

    // Generate days for the week
    const days = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

    const formatRange = (start: Date, end: Date) => {
        const formatDateSimple = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.`;
        const formatDateFull = (d: Date) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;

        return `${formatDateSimple(start)} - ${formatDateFull(end)}`;
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 2,
                borderBottom: '1px solid #333',
                backgroundColor: '#1e1e1e' // Match preview background usually
            }}>
                <Button onClick={handlePrevWeek} variant="contained" sx={{ minWidth: '40px' }}>&lt;</Button>

                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    {formatRange(weekStart, weekEnd)}
                </Typography>

                <Button onClick={handleNextWeek} variant="contained" sx={{ minWidth: '40px' }}>&gt;</Button>
            </Box>

            {/* Week Grid */}
            <Box sx={{ display: 'flex', flexGrow: 1, overflowY: 'auto', overflowX: 'auto' }}>
                {days.map((day, index) => (
                    <Box key={index} sx={{ flex: 1, minWidth: '200px', borderRight: index < 6 ? '1px solid #333' : 'none' }}>
                        <DayColumn
                            date={day}
                            tasks={tasks} // TODO: Filter tasks for this day!
                            currentTime={new Date()} // Only show on today
                            onCreateTask={(start, duration) => console.log('Create', start, duration)}
                            columnHeight={1000} // This should arguably be responsive or fixed high
                        />
                    </Box>
                ))}
            </Box>
        </Box>
    );
};
