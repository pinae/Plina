import React, { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { DayColumn } from './DayColumn';
import type { ViewTask } from './WeekViewTask';
import { splitTaskAcrossDays } from '../utils/taskSplitter';

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

    // Process tasks: Split across days
    const allSegments = tasks.flatMap(splitTaskAcrossDays);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
            {/* Navigation Header */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 2,
                borderBottom: '1px solid #333',
                backgroundColor: '#1e1e1e',
                zIndex: 20
            }}>
                <Button onClick={handlePrevWeek} variant="contained" sx={{ minWidth: '40px' }}>&lt;</Button>

                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    {formatRange(weekStart, weekEnd)}
                </Typography>

                <Button onClick={handleNextWeek} variant="contained" sx={{ minWidth: '40px' }}>&gt;</Button>
            </Box>

            {/* Days Header Row (Sticky effectively because outside scrollable area) */}
            <Box sx={{ display: 'flex', width: '100%', borderBottom: '1px solid #333', backgroundColor: '#1e1e1e', zIndex: 10 }}>
                {days.map((day, index) => (
                    <Box key={index} sx={{ flex: 1, minWidth: '200px', p: 1, textAlign: 'center', borderRight: index < 6 ? '1px solid #333' : 'none' }}>
                        <Typography variant="subtitle2" sx={{ color: '#aaa', fontWeight: 'bold' }}>
                            {day.toLocaleDateString('de-DE', { weekday: 'short' }).toUpperCase()}
                        </Typography>
                        <Typography variant="h5" sx={{ fontWeight: 'normal' }}>
                            {day.getDate().toString().padStart(2, '0')}
                        </Typography>
                    </Box>
                ))}
            </Box>

            {/* Week Grid (Scrollable) */}
            <Box sx={{ display: 'flex', flexGrow: 1, overflowY: 'auto', overflowX: 'auto' }}>
                {days.map((day, index) => {
                    // Filter tasks for this day
                    const dayTasks = allSegments.filter(task => {
                        const taskDate = new Date(task.startTime);
                        return taskDate.getDate() === day.getDate() &&
                            taskDate.getMonth() === day.getMonth() &&
                            taskDate.getFullYear() === day.getFullYear();
                    });

                    return (
                        <Box key={index} sx={{ flex: 1, minWidth: '200px', borderRight: index < 6 ? '1px solid #333' : 'none' }}>
                            <DayColumn
                                date={day}
                                tasks={dayTasks}
                                currentTime={new Date()} // Only show on today
                                onCreateTask={(start, duration) => console.log('Create', start, duration)}
                                columnHeight={1440}
                            />
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};
