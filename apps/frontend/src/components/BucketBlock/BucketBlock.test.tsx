import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BucketBlock } from './BucketBlock.tsx';
import type { DayZone } from '../../utils/planToWeek.ts';

const zone: DayZone = {
    id: 'b1', start: new Date('2026-07-08T09:00:00'), end: new Date('2026-07-08T13:00:00'),
    color: '#539dad', label: 'Deep Work', persisted: true, typeId: 1,
    topMinutes: 540, heightMinutes: 240,
};

describe('BucketBlock', () => {
    afterEach(cleanup);

    it('positions itself from the zone minutes and shows the label', () => {
        render(<BucketBlock zone={zone} columnHeight={1440} />);
        const block = screen.getByTestId('bucket-zone');
        // 1440px column: 1px per minute -> top 540px, height 240px.
        expect(block).toHaveStyle({ top: '540px', height: '240px' });
        expect(screen.getByText('Deep Work')).toBeInTheDocument();
    });

    it('calls onEdit on a plain click (no drag)', () => {
        const onEdit = vi.fn();
        render(<BucketBlock zone={zone} columnHeight={1440} onEdit={onEdit} />);
        const block = screen.getByTestId('bucket-zone');
        fireEvent.mouseDown(block, { clientY: 100, button: 0 });
        fireEvent.mouseUp(window, { clientY: 100 });
        expect(onEdit).toHaveBeenCalledWith(zone);
    });

    it('commits a move when the body is dragged', () => {
        const onChange = vi.fn();
        render(<BucketBlock zone={zone} columnHeight={1440} onChange={onChange} />);
        const block = screen.getByTestId('bucket-zone');
        // Drag down 60px (=60min at this zoom): 09:00 -> 10:00 the same day.
        fireEvent.mouseDown(block, { clientY: 100, button: 0 });
        fireEvent.mouseMove(window, { clientY: 160 });
        fireEvent.mouseUp(window, { clientY: 160 });
        expect(onChange).toHaveBeenCalledTimes(1);
        const [z, start, duration] = onChange.mock.calls[0];
        expect(z).toBe(zone);
        expect((start as Date).getDate()).toBe(8);
        expect((start as Date).getHours()).toBe(10);
        expect(duration).toBe(240);
    });

    it('commits a duration change when the bottom handle is dragged', () => {
        const onChange = vi.fn();
        render(<BucketBlock zone={zone} columnHeight={1440} onChange={onChange} />);
        const handle = screen.getByTestId('bucket-resize-bottom');
        // Drag the bottom edge down 60px: duration 240 -> 300, start unchanged.
        fireEvent.mouseDown(handle, { clientY: 780, button: 0 });
        fireEvent.mouseMove(window, { clientY: 840 });
        fireEvent.mouseUp(window, { clientY: 840 });
        expect(onChange).toHaveBeenCalledTimes(1);
        const [, start, duration] = onChange.mock.calls[0];
        expect((start as Date).getHours()).toBe(9);
        expect(duration).toBe(300);
    });

    it('moves the bucket to another day when resolveDay maps the pointer there', () => {
        const onChange = vi.fn();
        const resolveDay = vi.fn(() => new Date('2026-07-10T00:00:00'));
        render(<BucketBlock zone={zone} columnHeight={1440} onChange={onChange} resolveDay={resolveDay} />);
        const block = screen.getByTestId('bucket-zone');
        fireEvent.mouseDown(block, { clientY: 100, clientX: 50, button: 0 });
        fireEvent.mouseMove(window, { clientY: 160, clientX: 500 });
        fireEvent.mouseUp(window, { clientY: 160, clientX: 500 });
        expect(onChange).toHaveBeenCalledTimes(1);
        const [, start] = onChange.mock.calls[0];
        expect((start as Date).getDate()).toBe(10); // landed on Jul 10
        expect((start as Date).getHours()).toBe(10); // time from the vertical drag
    });
});
