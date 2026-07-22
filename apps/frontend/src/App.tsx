import { useState } from 'react';
import Layout from './components/Layout/Layout.tsx';
import { Box, Tabs, Tab } from '@mui/material';
import TaskList from './components/TaskList/TaskList.tsx';
import ProjectList from './components/ProjectList/ProjectList.tsx';
import TagList from './components/TagList/TagList.tsx';
import BucketTypeList from './components/BucketTypeList/BucketTypeList.tsx';
import Calendar from './components/Calendar/Calendar.tsx';
import PlannedWeekView from './components/PlannedWeekView/PlannedWeekView.tsx';
import DependencyEditor from './components/DependencyEditor/DependencyEditor.tsx';
import { PlanChooserDialog } from './components/PlanChooserDialog/PlanChooserDialog.tsx';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.tsx';
import { Button } from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';

function App() {
  const [tab, setTab] = useState(0);
  const [chooserOpen, setChooserOpen] = useState(false);

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  
  return (
    <Layout>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2, display: 'flex', alignItems: 'center' }}>
        <Tabs value={tab} onChange={handleChange} aria-label="plina tabs" sx={{ flexGrow: 1 }}>
          <Tab label="Week Overview" />
          <Tab label="Calendar Plan" />
          <Tab label="Tasks" />
          <Tab label="Projects" />
          <Tab label="Tags" />
          <Tab label="Time Buckets" />
          <Tab label="Dependencies" />
        </Tabs>
        <Button
          variant="contained"
          size="small"
          startIcon={<EventAvailableIcon />}
          onClick={() => setChooserOpen(true)}
          sx={{ mr: 1 }}
        >
          Plan my week
        </Button>
      </Box>
      <PlanChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onAccepted={() => setTab(0)}
      />

      <ErrorBoundary key={tab}>
        {tab === 0 && <PlannedWeekView />}
        {tab === 1 && <Calendar />}
        {tab === 2 && <TaskList />}
        {tab === 3 && <ProjectList />}
        {tab === 4 && <TagList />}
        {tab === 5 && <BucketTypeList />}
        {tab === 6 && <DependencyEditor />}
      </ErrorBoundary>
    </Layout>
  );
}

export default App;
