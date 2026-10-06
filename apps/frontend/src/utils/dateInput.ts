/** Values of <input type="datetime-local"> / "date" (local time) and back. */
const pad = (n: number) => String(n).padStart(2, '0');

export const toDateInput = (value: Date | string | null | undefined): string => {
    if (!value) return '';
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const toDateTimeInput = (value: Date | string | null | undefined): string => {
    if (!value) return '';
    const date = new Date(value);
    return `${toDateInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** "2026-10-06" -> local midnight of that day. */
export const fromDateInput = (value: string): Date => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
};

export const addDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};
