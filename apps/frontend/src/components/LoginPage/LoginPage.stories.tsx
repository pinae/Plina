import type { Meta, StoryObj } from '@storybook/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { LoginPage } from './LoginPage';
import { seededClient } from '../../testing/treeFixtures';

const meta: Meta<typeof LoginPage> = {
    title: 'Accounts/LoginPage',
    component: LoginPage,
    decorators: [(Story) => {
        const [client] = useState(() => seededClient());
        return <QueryClientProvider client={client}><Story /></QueryClientProvider>;
    }],
};
export default meta;
type Story = StoryObj<typeof LoginPage>;

/** Without single sign-on: a Plina account only. */
export const LocalAccounts: Story = { args: { singleSignOn: null } };

/** With OpenID Connect and mail configured: the provider first, Plina
 *  accounts too, and the password reset by mail. */
export const WithSingleSignOn: Story = {
    args: {
        singleSignOn: { name: 'Digisoul', login_url: '/django/oidc/authenticate/' },
        passwordResetUrl: '/django/accounts/password_reset/',
    },
};
