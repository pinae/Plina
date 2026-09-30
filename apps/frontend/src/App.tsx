import { useCallback, useState } from 'react';
import Layout from './components/Layout/Layout.tsx';
import { Box, Tabs, Tab } from '@mui/material';
import TaskList from './components/TaskList/TaskList.tsx';
import { OutlineView } from './components/OutlineView/OutlineView.tsx';
import { storeOutlineFilter } from './utils/outlineFilter.ts';
import TagList from './components/TagList/TagList.tsx';
import BucketTypeList from './components/BucketTypeList/BucketTypeList.tsx';
import Calendar from './components/Calendar/Calendar.tsx';
import PlannedWeekView from './components/PlannedWeekView/PlannedWeekView.tsx';
import DependencyEditor from './components/DependencyEditor/DependencyEditor.tsx';
import { PlanChooserDialog } from './components/PlanChooserDialog/PlanChooserDialog.tsx';
import { PlanMyWeekButton } from './components/PlanMyWeekButton/PlanMyWeekButton.tsx';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary.tsx';
import { AppHeader } from './components/AppHeader/AppHeader.tsx';
import { useIsMobile } from './hooks/useResponsive.ts';
import { useTimeZoneSync } from './hooks/useTimeZoneSync.ts';

// [desktop, phone] labels — short ones keep more tabs in view on a phone.
const TABS: [string, string][] = [
  ['Week Overview', 'Week'],
  ['Calendar Plan', 'Calendar'],
  ['Tasks', 'Tasks'],
  ['Projects', 'Projects'],
  ['Tags', 'Tags'],
  ['Time Buckets', 'Buckets'],
  ['Dependencies', 'Deps'],
];

function App() {
  const [tab, setTab] = useState(0);
  const [chooserOpen, setChooserOpen] = useState(false);
  // Re-plan coordination: a manual edit marks the plan dirty; a countdown on
  // the "Plan my week" button then triggers planning once dragging settles.
  const [planDirty, setPlanDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outlineKey, setOutlineKey] = useState(0);
  const compact = useIsMobile();
  // Recurring buckets ("every day at 14:00") follow the device's time zone.
  useTimeZoneSync();

  const handleChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTab(newValue);
  };

  const triggerPlan = useCallback(() => {
    setPlanDirty(false);
    setChooserOpen(true);
  }, []);


  return (
    <Layout>
      {/* Engage bar (UI-5): active project, tracker, quick add. */}
      <AppHeader
        onShowAllProjects={() => {
          // Projects tab with the "All projects" filter (§3.1).
          storeOutlineFilter('all');
          setOutlineKey(key => key + 1);
          setTab(3);
        }}
        actions={
          <PlanMyWeekButton
            dirty={planDirty}
            dragging={dragging}
            onTrigger={triggerPlan}
            onClick={triggerPlan}
            compact={compact}
          />
        }
      />
      <Box sx={{
        flexShrink: 0, borderBottom: 1, borderColor: 'divider',
        display: 'flex', alignItems: 'center', bgcolor: 'background.paper', px: 1,
      }}>
        <Tabs value={tab} onChange={handleChange} aria-label="plina tabs" variant="scrollable" scrollButtons="auto" sx={{ flexGrow: 1 }}>
          {TABS.map(([long, short]) => (
            <Tab key={long} label={compact ? short : long} aria-label={long} sx={compact ? { minWidth: 0, px: 1.5 } : undefined} />
          ))}
        </Tabs>
      </Box>
      <PlanChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onAccepted={() => setTab(0)}
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', p: tab === 0 || tab === 6 ? 0 : compact ? 1 : 2,
        // Phones: room to scroll the last rows clear of the ⊕ button.
        pb: compact ? 11 : undefined }}>
        <ErrorBoundary key={tab}>
          {tab === 0 && (
            <PlannedWeekView
              onDraggingChange={setDragging}
              onPlanDirty={() => setPlanDirty(true)}
            />
          )}
          {tab === 1 && <Calendar />}
          {tab === 2 && <TaskList />}
          {tab === 3 && <OutlineView key={outlineKey} />}
          {tab === 4 && <TagList />}
          {tab === 5 && <BucketTypeList />}
          {tab === 6 && <DependencyEditor />}
        </ErrorBoundary>
      </Box>
    </Layout>
  );
}

export default App;
