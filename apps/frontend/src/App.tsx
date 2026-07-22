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
      {/* The tab row is the top header bar (there is no separate title bar). */}
      <Box sx={{
        flexShrink: 0, borderBottom: 1, borderColor: 'divider',
        display: 'flex', alignItems: 'center', bgcolor: 'background.paper', px: 1,
      }}>
        <Tabs value={tab} onChange={handleChange} aria-label="plina tabs" variant="scrollable" scrollButtons="auto" sx={{ flexGrow: 1 }}>
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
          sx={{ mr: 1, flexShrink: 0 }}
        >
          Plan my week
        </Button>
      </Box>
      <PlanChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onAccepted={() => setTab(0)}
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', p: tab === 0 || tab === 6 ? 0 : 2 }}>
        <ErrorBoundary key={tab}>
          {tab === 0 && <PlannedWeekView />}
          {tab === 1 && <Calendar />}
          {tab === 2 && <TaskList />}
          {tab === 3 && <ProjectList />}
          {tab === 4 && <TagList />}
          {tab === 5 && <BucketTypeList />}
          {tab === 6 && <DependencyEditor />}
        </ErrorBoundary>
      </Box>
    </Layout>
  );
}

export default App;
