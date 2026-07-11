import { Component, type ReactNode } from 'react';
import { Alert, AlertTitle } from '@mui/material';

interface ErrorBoundaryProps {
    children: ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * A component crash must degrade to a visible message, never a blank page
 * (regression guard for the Dependencies-tab blank screen).  Error
 * boundaries still require a class component.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <Alert severity="error" role="alert" sx={{ m: 2 }}>
                    <AlertTitle>Something went wrong</AlertTitle>
                    {this.state.error.message}
                </Alert>
            );
        }
        return this.props.children;
    }
}
