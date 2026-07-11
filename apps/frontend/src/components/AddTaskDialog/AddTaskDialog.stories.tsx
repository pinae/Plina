import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Button} from '@mui/material';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AddTaskDialog} from './AddTaskDialog';

// Create a dummy QueryClient for the stories
const queryClient = new QueryClient();

const meta: Meta<typeof AddTaskDialog> = {
    title: 'Components/AddTaskDialog',
    component: AddTaskDialog,
    decorators: [
        (Story) => (
            <QueryClientProvider client={queryClient}>
                <Story/>
            </QueryClientProvider>
        ),
    ],
    tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AddTaskDialog>;

// Helper component to make the dialog easily testable/clickable in Storybook
const InteractiveDialogWrapper = () => {
    const [open, setOpen] = useState(true);

    return (
        <div style={{padding: '2rem'}}>
            <Button variant="contained" onClick={() => setOpen(true)}>
                Open Add Task Dialog
            </Button>
            <AddTaskDialog open={open} onClose={() => setOpen(false)}/>
        </div>
    );
};

export const Default: Story = {
    render: () => <InteractiveDialogWrapper/>,
};