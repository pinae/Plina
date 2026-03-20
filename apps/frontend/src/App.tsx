import { useState } from 'react';
import Layout from './components/Layout';
import { Box, Tabs, Tab } from '@mui/material';
import TaskList from './components/TaskList';
import Calendar from './components/Calendar';
import { WeekView } from './components/WeekView';

function App() {
  const [tab, setTab] = useState(0);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  const dummyTasks = [
    {
      title: 'Meeting with Client',
      startTime: new Date(new Date().setHours(10, 0, 0, 0)).toISOString(), // Today 10:00
      duration: 60,
      color: '#ff9800',
      manuallySet: true,
      description: 'Discuss project requirements',
      tags: [],
      continues: false,
    },
    {
      title: 'Deep Work',
      startTime: new Date(new Date().setHours(14, 0, 0, 0)).toISOString(), // Today 14:00
      duration: 120,
      color: '#2196f3',
      manuallySet: true,
      description: 'Coding session',
      tags: [],
      continues: false,
    }
  ];

  return (
    <Layout fullWidth={tab === 0}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={handleChange} aria-label="plina tabs">
          <Tab label="Week Overview" />
          <Tab label="Calendar Plan" />
          <Tab label="Task List" />
        </Tabs>
      </Box>

      {tab === 0 && <WeekView tasks={dummyTasks} initialDate={new Date()} />}
      {tab === 1 && <Calendar />}
      {tab === 2 && <TaskList />}
    </Layout>
  );
}

export default App;
