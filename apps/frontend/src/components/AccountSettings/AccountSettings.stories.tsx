import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Box } from '@mui/material';
import { AccountSettings } from './AccountSettings';
import { loggedInSession, seededClient } from '../../testing/treeFixtures';
import type { Session } from '../../types';

function Account({ session }: { session: Session }) {
    const [client] = useState(() => {
        const seeded = seededClient();
        seeded.setQueryData(['session'], session);
        return seeded;
    });
    return <QueryClientProvider client={client}><Box sx={{ p: 2, width: 520 }}><AccountSettings /></Box></QueryClientProvider>;
}

const meta: Meta<typeof Account> = { title: 'Accounts/AccountSettings', component: Account };
export default meta;
type Story = StoryObj<typeof Account>;

/** A Plina account: logging out and a new password. */
export const PlinaAccount: Story = { args: { session: loggedInSession() } };

/** After the single sign-on: no password here (the provider's job). */
export const SingleSignOn: Story = {
    args: {
        session: loggedInSession({
            user: { ...loggedInSession().user!, single_sign_on: true, can_change_password: false },
            single_sign_on: { name: 'Digisoul', login_url: '/django/oidc/authenticate/' },
        }),
    },
};
