import { useCallback, useState } from 'react';
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
import { PlanMyWeekButton } from './components/PlanMyWeekButton/PlanMyWeekButton.tsx';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.tsx';

function App() {
  const [tab, setTab] = useState(0);
  const [chooserOpen, setChooserOpen] = useState(false);
  // Re-plan coordination: a manual edit marks the plan dirty; a countdown on
  // the "Plan my week" button then triggers planning once dragging settles.
  const [planDirty, setPlanDirty] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  const triggerPlan = useCallback(() => {
    setPlanDirty(false);
    setChooserOpen(true);
  }, []);


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
        <PlanMyWeekButton
          dirty={planDirty}
          dragging={dragging}
          onTrigger={triggerPlan}
          onClick={triggerPlan}
        />
      </Box>
      <PlanChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onAccepted={() => setTab(0)}
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', p: tab === 0 || tab === 6 ? 0 : 2 }}>
        <ErrorBoundary key={tab}>
          {tab === 0 && (
            <PlannedWeekView
              onDraggingChange={setDragging}
              onPlanDirty={() => setPlanDirty(true)}
            />
          )}
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
