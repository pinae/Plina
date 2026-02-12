import { useState } from 'react';
import Layout from './components/Layout';
import { Box, Tabs, Tab } from '@mui/material';
import TaskList from './components/TaskList';
import Calendar from './components/Calendar';
import WeekView from './components/WeekView';

function App() {
  const [tab, setTab] = useState(0);

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  return (
    <Layout fullWidth={tab === 0}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={tab} onChange={handleChange} aria-label="plina tabs">
          <Tab label="Week Overview" />
          <Tab label="Calendar Plan" />
          <Tab label="Task List" />
        </Tabs>
      </Box>

      {tab === 0 && <WeekView />}
      {tab === 1 && <Calendar />}
      {tab === 2 && <TaskList />}
    </Layout>
  );
}

export default App;
