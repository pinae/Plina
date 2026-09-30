import { useCallback, useState } from 'react';
import Layout from './components/Layout/Layout.tsx';
import { Box, Tabs, Tab } from '@mui/material';
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

type TabKey = 'tasks' | 'week' | 'calendar' | 'tags' | 'buckets' | 'dependencies';

// Tasks (the task tree) first, the Week next (docs/tasks-tab.md, T-2).
// [key, desktop label, phone label] — short labels keep more tabs in view.
const TABS: [TabKey, string, string][] = [
  ['tasks', 'Tasks', 'Tasks'],
  ['week', 'Week Overview', 'Week'],
  ['calendar', 'Calendar Plan', 'Calendar'],
  ['tags', 'Tags', 'Tags'],
  ['buckets', 'Time Buckets', 'Buckets'],
  ['dependencies', 'Dependencies', 'Deps'],
];

// Panes that draw edge to edge (their own scrolling and padding).
const FULL_BLEED: TabKey[] = ['week', 'dependencies'];

function App() {
  const [tab, setTab] = useState<TabKey>('tasks');
  const [chooserOpen, setChooserOpen] = useState(false);
  // Re-plan coordination: a manual edit marks the plan dirty; a countdown on
  // the "Plan my week" button then triggers planning once dragging settles.
  const [planDirty, setPlanDirty] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outlineKey, setOutlineKey] = useState(0);
  const compact = useIsMobile();
  // Recurring buckets ("every day at 14:00") follow the device's time zone.
  useTimeZoneSync();

  const handleChange = (_event: React.SyntheticEvent, newValue: TabKey) => {
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
          // The Tasks tab showing every project (§3.1).
          storeOutlineFilter('all');
          setOutlineKey(key => key + 1);
          setTab('tasks');
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
          {TABS.map(([key, long, short]) => (
            <Tab key={key} value={key} label={compact ? short : long} aria-label={long} sx={compact ? { minWidth: 0, px: 1.5 } : undefined} />
          ))}
        </Tabs>
      </Box>
      <PlanChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onAccepted={() => setTab('week')}
      />

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto', p: FULL_BLEED.includes(tab) ? 0 : compact ? 1 : 2,
        // Phones: room to scroll the last rows clear of the ⊕ button.
        pb: compact ? 11 : undefined }}>
        <ErrorBoundary key={tab}>
          {tab === 'tasks' && <OutlineView key={outlineKey} />}
          {tab === 'week' && (
            <PlannedWeekView
              onDraggingChange={setDragging}
              onPlanDirty={() => setPlanDirty(true)}
            />
          )}
          {tab === 'calendar' && <Calendar />}
          {tab === 'tags' && <TagList />}
          {tab === 'buckets' && <BucketTypeList />}
          {tab === 'dependencies' && <DependencyEditor />}
        </ErrorBoundary>
      </Box>
    </Layout>
  );
}

export default App;
