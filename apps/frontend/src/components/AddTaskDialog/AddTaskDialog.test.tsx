import {render, screen, fireEvent} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {AddTaskDialog} from './AddTaskDialog';
import {useCreateTask} from '../../queries.tsx';

// Mock the react-query hook
vi.mock('../../queries.tsx', () => ({
    useCreateTask: vi.fn(),
}));

describe('AddTaskDialog', () => {
    const mockMutate = vi.fn();
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup default hook return value
        (useCreateTask as vi.Mock).mockReturnValue({
            mutate: mockMutate,
            isPending: false,
        });
    });

    it('renders correctly when open', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);
        expect(screen.getByText('New task')).toBeInTheDocument();
        expect(screen.getByLabelText(/Header/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Duration/i)).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        render(<AddTaskDialog open={false} onClose={mockOnClose}/>);
        expect(screen.queryByText('New task')).not.toBeInTheDocument();
    });

    it('calls onClose when Cancel is clicked', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);
        fireEvent.click(screen.getByRole('button', {name: /Cancel/i}));
        expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('prevents submission if header is empty', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);
        fireEvent.click(screen.getByRole('button', {name: /Create/i}));
        expect(mockMutate).not.toHaveBeenCalled();
    });

    it('submits correctly with default hours', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);

        fireEvent.change(screen.getByLabelText(/Header/i), {target: {value: 'Fix bug'}});
        fireEvent.click(screen.getByRole('button', {name: /Create/i}));

        expect(mockMutate).toHaveBeenCalledWith(
            {header: 'Fix bug', duration: '01:00:00'},
            expect.any(Object)
        );
    });

    it('submits correctly when pressing Enter in the header field', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);

        const headerInput = screen.getByLabelText(/Header/i);
        fireEvent.change(headerInput, {target: {value: 'Write tests'}});
        fireEvent.keyDown(headerInput, {key: 'Enter', code: 'Enter'});

        expect(mockMutate).toHaveBeenCalledWith(
            {header: 'Write tests', duration: '01:00:00'},
            expect.any(Object)
        );
    });

    it('formats decimal and edge-case hours correctly', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);

        fireEvent.change(screen.getByLabelText(/Header/i), {target: {value: 'Long task'}});

        // Test decimal rounding (Math.floor(2.8) -> 2)
        fireEvent.change(screen.getByLabelText(/Duration/i), {target: {value: '2.8'}});
        fireEvent.click(screen.getByRole('button', {name: /Create/i}));

        expect(mockMutate).toHaveBeenCalledWith(
            {header: 'Long task', duration: '02:00:00'},
            expect.any(Object)
        );
    });

    it('formats 0 or invalid hours to default 1 hour fallback', () => {
        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);

        fireEvent.change(screen.getByLabelText(/Header/i), {target: {value: 'Zero task'}});
        fireEvent.change(screen.getByLabelText(/Duration/i), {target: {value: '0'}});
        fireEvent.click(screen.getByRole('button', {name: /Create/i}));

        // "0 || 1" evaluates to 1
        expect(mockMutate).toHaveBeenCalledWith(
            {header: 'Zero task', duration: '01:00:00'},
            expect.any(Object)
        );
    });

    it('clears state and closes dialog on successful mutation', () => {
        // Mock the mutation to immediately fire the onSuccess callback
        mockMutate.mockImplementation((_data, options) => {
            if (options?.onSuccess) {
                options.onSuccess();
            }
        });

        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);

        const headerInput = screen.getByLabelText(/Header/i);
        fireEvent.change(headerInput, {target: {value: 'Completed task'}});
        fireEvent.click(screen.getByRole('button', {name: /Create/i}));

        expect(mockMutate).toHaveBeenCalled();
        expect(mockOnClose).toHaveBeenCalledTimes(1);

        // State is cleared (though the dialog will be unmounted by parent, we check value internally)
        expect(headerInput).toHaveValue('');
    });

    it('disables the create button while mutation is pending', () => {
        (useCreateTask as vi.Mock).mockReturnValue({
            mutate: mockMutate,
            isPending: true,
        });

        render(<AddTaskDialog open={true} onClose={mockOnClose}/>);
        const createBtn = screen.getByRole('button', {name: /Create/i});

        expect(createBtn).toBeDisabled();
    });
});