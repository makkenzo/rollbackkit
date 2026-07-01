import { DemoDashboard } from '@/app/components/demo-dashboard';
import { getDemoActionHistory } from '@/lib/server/action-history-repository';
import { getDemoDashboardData } from '@/lib/server/demo-repository';

export const dynamic = 'force-dynamic';

export default async function DemoHomePage() {
    const [dashboard, actionHistory] = await Promise.all([
        getDemoDashboardData(),
        getDemoActionHistory(),
    ]);

    return <DemoDashboard actionHistory={actionHistory} dashboard={dashboard} />;
}
